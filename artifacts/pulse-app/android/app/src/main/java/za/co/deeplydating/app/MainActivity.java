package za.co.deeplydating.app;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

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
    }
}