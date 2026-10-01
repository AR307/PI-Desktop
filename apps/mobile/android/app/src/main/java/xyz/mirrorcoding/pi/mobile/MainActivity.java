package xyz.mirrorcoding.pi.mobile;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileAppearancePlugin.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity installs its NoActionBar theme in super.onCreate.
        // Creating the decor earlier locks in the launch theme's native title bar.
        EdgeToEdge.enable(this);
    }
}
