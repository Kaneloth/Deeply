package za.co.deeplydating.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeWebViewClient;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int VIDEO_CALL_PERMISSION_REQUEST_CODE = 8901;

    // Holds the WebView's own pending request while Android's runtime
    // permission dialog is on screen, so onRequestPermissionsResult
    // below can resolve it once the user actually responds. Null
    // whenever nothing is currently pending.
    private PermissionRequest pendingWebViewPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Direct, official fix for Play Console's "Edge-to-edge may not
        // display for all users" warning (targeting SDK 35, Android 15+
        // enables edge-to-edge by default). Called after, not before,
        // super.onCreate() — matching this file's own established
        // convention below for the same reason: avoids any risk of
        // interfering with BridgeActivity's own window/WebView
        // initialization, which happens inside super.onCreate() itself.
        //
        // This is separate from, and doesn't resolve, the "deprecated
        // APIs for edge-to-edge" warning — that one comes from
        // Window.setStatusBarColor/setNavigationBarColor calls buried
        // inside third-party library internals (Material Components,
        // ion-camera-lib, even Sentry's own Android SDK), not from
        // anything in this app's own code, so it isn't fixable from
        // here.
        // EdgeToEdge.enable() was added here to address a low-priority
        // Play Console recommendation, but confirmed to cause a severe
        // layout regression: content overlapping the status bar, the
        // bottom nav hidden, and unreadable status bar icons in light
        // mode. Enabling edge-to-edge means content draws BEHIND the
        // system bars by design — that only works correctly once the
        // app's own CSS properly reserves space for them (safe-area-
        // inset-* padding on the header/nav, viewport-fit=cover set).
        // Reverted rather than left broken while that's sorted out
        // properly; revisit only after confirming the CSS side is
        // actually in place first.

        // Disables Android's native WebView overscroll glow/bounce
        // effect. This is a completely separate mechanism from the CSS
        // `overscroll-behavior` property already set on <main> in
        // AppShell.tsx — that CSS property only controls browser-level
        // scroll chaining and has zero effect on this native Android
        // edge-glow animation, which lives entirely outside anything
        // CSS/JS can reach.
        //
        // Without this, pulling past the top of any scrollable content
        // in the native app triggers Android's own overscroll glow at
        // the same time as our custom pull-to-refresh gesture — two
        // independent animations competing for the same physical
        // gesture. That's what was actually behind "needs two pulls,
        // not smooth"; the CSS fix addressed the browser-level version
        // of this same class of problem, but this native-level one was
        // still firing regardless, since it isn't something CSS can
        // suppress at all.
        //
        // super.onCreate() must run first — that's what actually
        // initializes the bridge and WebView; getBridge().getWebView()
        // would be null before this point.
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);

        // Video calling (VideoCallScreen.tsx / Agora Web SDK) needs the
        // WebView itself to grant camera/mic access to the page's own
        // getUserMedia() call — a permission layer tracked entirely
        // separately from the Android OS-level app permission
        // (CAMERA/RECORD_AUDIO in the manifest).
        //
        // CONFIRMED REGRESSION (fixed here): the previous version of
        // this override only ever CHECKED whether the OS-level
        // permission was already granted — if not, it called
        // request.deny() immediately, without ever actually triggering
        // Android's own runtime permission dialog at all. On any fresh
        // install, that check is always false, so every single user was
        // silently denied with no prompt ever shown — which is exactly
        // the "camera/mic permission requests no longer appear at all"
        // regression this was rebuilt to fix. Checking is not the same
        // as asking; this version now actually asks when needed.
        //
        // Deliberately uses the older, requestCode-based
        // ActivityCompat.requestPermissions() / onRequestPermissionsResult()
        // pair rather than the modern ActivityResultLauncher API — that
        // modern API requires registering the launcher before onCreate/
        // onStart completes, which this callback (fired later, at an
        // arbitrary point whenever the WebView happens to request
        // camera/mic) can't satisfy; calling it from here risks exactly
        // the null-pointer crash the original version's own comment
        // was already trying to avoid. The older API has no such
        // registration requirement and can be called safely from
        // exactly this context.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                List<String> resources = Arrays.asList(request.getResources());
                boolean needsCamera = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                boolean needsMic = resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);

                boolean cameraOk = !needsCamera
                    || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED;
                boolean micOk = !needsMic
                    || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED;

                if (cameraOk && micOk) {
                    request.grant(request.getResources());
                    return;
                }

                // Actually ask — this is the fix. Only requests the
                // specific OS-level permission(s) still missing, not
                // both unconditionally, so a user who already granted
                // one of the two in an earlier session isn't asked for
                // it again.
                List<String> permissionsToRequest = new ArrayList<>();
                if (!cameraOk) permissionsToRequest.add(Manifest.permission.CAMERA);
                if (!micOk) permissionsToRequest.add(Manifest.permission.RECORD_AUDIO);

                pendingWebViewPermissionRequest = request;
                ActivityCompat.requestPermissions(
                    MainActivity.this,
                    permissionsToRequest.toArray(new String[0]),
                    VIDEO_CALL_PERMISSION_REQUEST_CODE
                );
            }
        });

        // Explicit fix for announcement links using non-http(s) schemes
        // (market:// specifically, for linking straight to the Play
        // Store app rather than its web listing — see
        // AnnouncementBanner.tsx). Confirmed real bug otherwise: plain
        // Android WebViews only know how to handle http:// and https://
        // — any other scheme is simply swallowed silently rather than
        // handed off to whatever app owns it, which is exactly what
        // "the link bounces back into the app" actually is: nothing
        // happened at all, because the WebView never knew what to do
        // with it.
        //
        // Capacitor's own default BridgeWebViewClient already calls
        // bridge.launchIntent(url) for non-http(s) schemes internally —
        // this override takes direct, explicit control instead of
        // relying on that internal behavior working correctly on every
        // Android version, which couldn't be confirmed without direct
        // device-level debugging. Extends BridgeWebViewClient
        // specifically (not a plain WebViewClient) — Capacitor relies on
        // its own WebViewClient to inject the JavaScript bridge plugins
        // depend on; replacing it with an unrelated WebViewClient would
        // silently break every native plugin in this app.
        getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    // Let Capacitor's own default handling (including
                    // its JS bridge injection) continue exactly as normal.
                    return super.shouldOverrideUrlLoading(view, request);
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, url);
                    startActivity(intent);
                } catch (ActivityNotFoundException e) {
                    // No app on the device can handle this scheme (e.g.
                    // Play Store itself isn't installed) — nothing more
                    // to do; at least this doesn't crash.
                }
                return true;
            }
        });
    }

    // Resolves the WebView's pending request once the user actually
    // responds to the OS-level dialog triggered above — grants only if
    // every permission that was asked for was actually granted;
    // otherwise denies, matching the WebView's own binary grant/deny API.
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != VIDEO_CALL_PERMISSION_REQUEST_CODE || pendingWebViewPermissionRequest == null) {
            return;
        }

        boolean allGranted = true;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (allGranted) {
            pendingWebViewPermissionRequest.grant(pendingWebViewPermissionRequest.getResources());
        } else {
            pendingWebViewPermissionRequest.deny();
        }
        pendingWebViewPermissionRequest = null;
    }
}