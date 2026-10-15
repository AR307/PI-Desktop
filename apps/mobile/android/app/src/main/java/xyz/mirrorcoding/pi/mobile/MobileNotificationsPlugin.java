package xyz.mirrorcoding.pi.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Attention notifications for shared desktop sessions and the background
 * keep-alive switch. Text arrives localized from the WebView; this plugin owns
 * channels, lock-screen redaction, tap routing and the service lifecycle.
 */
@CapacitorPlugin(
    name = "MobileNotifications",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = MobileNotificationsPlugin.PERMISSION) }
)
public class MobileNotificationsPlugin extends Plugin {
    static final String PERMISSION = "notifications";
    static final String CHANNEL_ATTENTION = "pi.attention";
    static final String CHANNEL_RESULTS = "pi.results";
    static final String CHANNEL_BACKGROUND = "pi.background";
    private static final String ACTION_OPEN_SESSION = "xyz.mirrorcoding.pi.mobile.OPEN_SESSION";
    private static final String EXTRA_DESKTOP = "xyz.mirrorcoding.pi.mobile.DESKTOP_ID";
    private static final String EXTRA_SESSION = "xyz.mirrorcoding.pi.mobile.SESSION_ID";
    private static final int SESSION_NOTIFICATION_ID = 0x50490002;

    // Plugin calls run on Capacitor's plugin thread; lifecycle callbacks run on the main thread.
    private volatile String publicText = "A shared session has an update";
    private volatile boolean keepAliveWanted = false;
    private volatile String keepAliveTitle = "PI Mobile";
    private volatile String keepAliveBody = "";
    private volatile boolean visible = true;

    @Override
    public void load() {
        createChannels("Needs your action", "Task results", "Background connection");
        if (getActivity() != null) deliverTap(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        deliverTap(intent);
    }

    @Override
    protected void handleOnStart() {
        visible = true;
        stopKeepAlive();
    }

    @Override
    protected void handleOnStop() {
        visible = false;
        // Leaving the foreground is the window in which Android 12+ still lets an
        // app start a foreground service.
        if (keepAliveWanted) startKeepAlive();
    }

    @Override
    protected void handleOnDestroy() {
        stopKeepAlive();
    }

    private void deliverTap(Intent intent) {
        if (intent == null || !ACTION_OPEN_SESSION.equals(intent.getAction())) return;
        String desktopId = intent.getStringExtra(EXTRA_DESKTOP);
        String sessionId = intent.getStringExtra(EXTRA_SESSION);
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(EXTRA_DESKTOP);
        intent.removeExtra(EXTRA_SESSION);
        if (desktopId == null || sessionId == null) return;
        JSObject route = new JSObject();
        route.put("desktopId", desktopId);
        route.put("sessionId", sessionId);
        // Retained until the WebView registers its listener after a cold start.
        notifyListeners("notificationTapped", route, true);
    }

    private void createChannels(String attention, String results, String background) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        // Lock-screen redaction is per notification (VISIBILITY_PRIVATE plus a public
        // version); Android ignores a lock-screen visibility set by the app on a channel.
        NotificationChannel urgent = new NotificationChannel(CHANNEL_ATTENTION, attention, NotificationManager.IMPORTANCE_HIGH);
        NotificationChannel outcome = new NotificationChannel(CHANNEL_RESULTS, results, NotificationManager.IMPORTANCE_DEFAULT);
        NotificationChannel quiet = new NotificationChannel(CHANNEL_BACKGROUND, background, NotificationManager.IMPORTANCE_MIN);
        quiet.setShowBadge(false);
        manager.createNotificationChannel(urgent);
        manager.createNotificationChannel(outcome);
        manager.createNotificationChannel(quiet);
    }

    private String permission() {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (Build.VERSION.SDK_INT < 33) return enabled ? "granted" : "denied";
        PermissionState state = getPermissionState(PERMISSION);
        if (state == PermissionState.GRANTED) return enabled ? "granted" : "denied";
        return state == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("permission", permission());
        result.put("keepAlive", RelayKeepAliveService.running);
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("batteryRestricted", power != null && !power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        return result;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState(PERMISSION) != PermissionState.GRANTED) {
            requestPermissionForAlias(PERMISSION, call, "permissionResult");
            return;
        }
        call.resolve(state());
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSObject names = call.getObject("channels", new JSObject());
        createChannels(
            names.getString("attention", "Needs your action"),
            names.getString("results", "Task results"),
            names.getString("background", "Background connection")
        );
        String text = call.getString("publicText");
        if (text != null && !text.isEmpty()) publicText = text;
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        String tag = call.getString("tag");
        JSObject route = call.getObject("route");
        String desktopId = route != null ? route.getString("desktopId") : null;
        String sessionId = route != null ? route.getString("sessionId") : null;
        if (tag == null || desktopId == null || sessionId == null) {
            call.reject("invalid_notification");
            return;
        }
        if (!"granted".equals(permission())) {
            call.resolve();
            return;
        }
        boolean urgent = "attention".equals(call.getString("channel"));
        String channel = urgent ? CHANNEL_ATTENTION : CHANNEL_RESULTS;
        Intent open = new Intent(getContext(), MainActivity.class)
            .setAction(ACTION_OPEN_SESSION)
            .putExtra(EXTRA_DESKTOP, desktopId)
            .putExtra(EXTRA_SESSION, sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(getContext(), tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification redacted = new NotificationCompat.Builder(getContext(), channel)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(getContext().getString(R.string.app_name))
            .setContentText(publicText)
            .build();
        String body = call.getString("body", "");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channel);
        String subtitle = call.getString("subtitle");
        if (subtitle != null && !subtitle.isEmpty()) builder.setSubText(subtitle);
        Notification notification = builder
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(call.getString("title", ""))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setWhen(call.getLong("when", System.currentTimeMillis()))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(content)
            .setCategory(urgent ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_STATUS)
            .setPriority(urgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(redacted)
            .build();
        try {
            NotificationManagerCompat.from(getContext()).notify(tag, SESSION_NOTIFICATION_ID, notification);
            call.resolve();
        } catch (SecurityException error) {
            call.reject("notifications_not_permitted", error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String tag = call.getString("tag");
        if (tag != null) NotificationManagerCompat.from(getContext()).cancel(tag, SESSION_NOTIFICATION_ID);
        call.resolve();
    }

    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        keepAliveWanted = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        keepAliveTitle = call.getString("title", keepAliveTitle);
        keepAliveBody = call.getString("body", keepAliveBody);
        if (!keepAliveWanted) stopKeepAlive();
        else if (RelayKeepAliveService.running) RelayKeepAliveService.update(getContext(), keepAliveTitle, keepAliveBody);
        else if (!visible) startKeepAlive();
        JSObject result = new JSObject();
        result.put("running", RelayKeepAliveService.running);
        call.resolve(result);
    }

    private void startKeepAlive() {
        Intent intent = new Intent(getContext(), RelayKeepAliveService.class)
            .putExtra(RelayKeepAliveService.EXTRA_TITLE, keepAliveTitle)
            .putExtra(RelayKeepAliveService.EXTRA_BODY, keepAliveBody);
        RelayKeepAliveService.wanted = true;
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (IllegalStateException | SecurityException error) {
            // Android refuses background starts outside its exemptions; the next
            // transition out of the foreground tries again.
            RelayKeepAliveService.wanted = false;
        }
    }

    private void stopKeepAlive() {
        // A start that is still in flight stops itself right after startForeground().
        RelayKeepAliveService.wanted = false;
        if (RelayKeepAliveService.running) getContext().stopService(new Intent(getContext(), RelayKeepAliveService.class));
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "notifications");
        String packageName = getContext().getPackageName();
        Intent intent;
        if ("battery".equals(target)) {
            intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        } else if ("notifications".equals(target) && Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("settings_unavailable", error);
        }
    }
}
