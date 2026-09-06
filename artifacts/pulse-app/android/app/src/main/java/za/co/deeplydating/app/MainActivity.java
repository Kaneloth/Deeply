package za.co.deeplydating.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
        // not smooth": the CSS fix addressed the browser-level version
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
        // (CAMERA/RECORD_AUDIO in the manifest). Confirmed directly via
        // Sentry, using the page's own navigator.permissions.query()
        // API: this WebView-level state was stuck at "prompt" — never
        // actually reaching "granted" — even with the OS-level
        // permission fully confirmed granted through its own runtime
        // prompts, on a completely fresh install, with the freshest
        // possible user-gesture context. Capacitor's own
        // BridgeWebChromeClient.onPermissionRequest is supposed to
        // handle exactly this bridging, but wasn't doing so correctly
        // on this specific device for reasons that weren't further
        // diagnosable without native-level debugging tools this device
        // doesn't support (no working USB debugging).
        //
        // This override bypasses whatever that gap actually is by
        // explicitly granting the WebView's request directly, once the
        // OS-level permission is confirmed already in place. It
        // deliberately never calls into this class's own inherited
        // permission-request handling (super.onPermissionRequest) even
        // as a fallback — that machinery depends on Activity-lifecycle
        // wiring (ActivityResultLauncher registration) that only
        // happens correctly through Capacitor's own initialization
        // sequence, not through this constructor alone; falling back to
        // it here risks a null-pointer crash instead. If the OS-level
        // permission genuinely isn't granted, this simply denies the
        // WebView's request directly — the app's own getUserMedia()
        // call already surfaces a clear, already-handled error message
        // for that case.
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
                } else {
                    request.deny();
                }
            }
        });
    }
}