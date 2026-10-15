package xyz.mirrorcoding.pi.mobile;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the app process at foreground-service importance while the phone waits
 * for shared desktop work, so the WebView keeps its relay connections and can
 * raise attention notifications. It holds no connection of its own and never
 * outlives the task: removing the app from recents stops it.
 */
public class RelayKeepAliveService extends Service {
    static final String EXTRA_TITLE = "xyz.mirrorcoding.pi.mobile.KEEP_ALIVE_TITLE";
    static final String EXTRA_BODY = "xyz.mirrorcoding.pi.mobile.KEEP_ALIVE_BODY";
    private static final int NOTIFICATION_ID = 0x50490001;
    static volatile boolean running = false;
    /** Cleared by a stop that may arrive before a requested start was delivered. */
    static volatile boolean wanted = false;

    static Notification notification(Context context, String title, String body) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, MobileNotificationsPlugin.CHANNEL_BACKGROUND)
            .setSmallIcon(R.drawable.ic_stat_pi)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(content)
            .build();
    }

    /** Refresh the ongoing notification text without restarting the service. */
    static void update(Context context, String title, String body) {
        if (!running) return;
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification(context, title, body));
        } catch (SecurityException ignored) {
            // Without notification permission the service still runs; only its text is hidden.
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : "PI Mobile";
        String body = intent != null && intent.getStringExtra(EXTRA_BODY) != null ? intent.getStringExtra(EXTRA_BODY) : "";
        // remoteMessaging has no daily runtime limit; older releases only know dataSync.
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            : Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        // startForegroundService() obliges this call even when the start is already
        // obsolete; stopping afterwards avoids the missed-start crash.
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(this, title, body), type);
        running = true;
        if (!wanted) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }
}
