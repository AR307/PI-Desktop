package xyz.mirrorcoding.pi.mobile;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core SystemBars pads the native decor on WebView < 140, outside CSS. */
@CapacitorPlugin(name = "MobileAppearance")
public class MobileAppearancePlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean dark = "dark".equals(call.getString("theme"));
        getBridge().executeOnMainThread(() -> {
            // SystemBars reads this attribute again after rotation/configuration changes.
            getActivity().getTheme().applyStyle(dark ? R.style.PiWindowDark : R.style.PiWindowLight, true);
            getActivity().getWindow().getDecorView().setBackgroundColor(Color.parseColor(dark ? "#181818" : "#ffffff"));
            call.resolve();
        });
    }
}
