package xyz.mirrorcoding.pi.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "MobileUpdate")
public class MobileUpdatePlugin extends Plugin {
    private static final String MANIFEST_URL = "https://github.com/AR307/Mirrorcoding-APP/releases/latest/download/mobile-update.json";
    private static final String PREFS = "pi_mobile_update";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String DOWNLOAD_FILE = "download_file";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private DownloadManager manager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private boolean isDebugBuild() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private boolean allowedUrl(String value, String suffix) {
        try {
            Uri uri = Uri.parse(value);
            boolean official = "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost())
                && uri.getPath() != null && uri.getPath().startsWith("/AR307/Mirrorcoding-APP/releases/");
            boolean fixture = isDebugBuild() && "http".equals(uri.getScheme())
                && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()) || "10.0.2.2".equals(uri.getHost()));
            return (official || fixture) && uri.getPath() != null && uri.getPath().endsWith(suffix);
        } catch (Exception ignored) { return false; }
    }

    @PluginMethod
    public void getInstalledInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            result.put("androidSdk", Build.VERSION.SDK_INT);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read installed version", error);
        }
    }

    @PluginMethod
    public void fetchManifest(PluginCall call) {
        String selectedUrl = isDebugBuild() ? call.getString("url", MANIFEST_URL) : MANIFEST_URL;
        if (!allowedUrl(selectedUrl, "mobile-update.json")) { call.reject("Invalid mobile update manifest URL"); return; }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(selectedUrl).openConnection();
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("Accept", "application/json");
                if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode());
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int size;
                    while ((size = input.read(buffer)) != -1) {
                        bytes.write(buffer, 0, size);
                        if (bytes.size() > 131072) throw new IllegalStateException("Update manifest is too large");
                    }
                    JSObject result = new JSObject();
                    result.put("manifest", new JSObject(bytes.toString(StandardCharsets.UTF_8.name())));
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject("Unable to check for mobile updates", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "pi-mobile-update-manifest").start();
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !allowedUrl(url, ".apk")) {
            call.reject("Invalid mobile update URL");
            return;
        }
        try {
            String file = "pi-mobile-" + System.currentTimeMillis() + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("PI Mobile update");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "updates/" + file);
            long id = manager().enqueue(request);
            prefs().edit().putLong(DOWNLOAD_ID, id).putString(DOWNLOAD_FILE, file).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to start APK download", error);
        }
    }

    private JSObject downloadState() {
        JSObject state = new JSObject();
        long id = prefs().getLong(DOWNLOAD_ID, -1);
        state.put("status", "idle");
        state.put("downloadedBytes", 0);
        state.put("totalBytes", 0);
        if (id < 0) return state;
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return state;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            state.put("downloadedBytes", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
            state.put("totalBytes", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            state.put("status", status == DownloadManager.STATUS_SUCCESSFUL ? "downloaded"
                : status == DownloadManager.STATUS_FAILED ? "failed" : "downloading");
            if (status == DownloadManager.STATUS_FAILED) state.put("reason", cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));
        }
        return state;
    }

    @PluginMethod
    public void getDownload(PluginCall call) {
        call.resolve(downloadState());
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long id = prefs().getLong(DOWNLOAD_ID, -1);
        if (id >= 0) manager().remove(id);
        prefs().edit().remove(DOWNLOAD_ID).remove(DOWNLOAD_FILE).apply();
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (!"downloaded".equals(downloadState().optString("status"))) {
            call.reject("APK download is not complete");
            return;
        }
        String fileName = prefs().getString(DOWNLOAD_FILE, null);
        File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (fileName == null || directory == null) {
            call.reject("Downloaded APK is unavailable");
            return;
        }
        File apk = new File(new File(directory, "updates"), fileName);
        if (!apk.isFile()) {
            call.reject("Downloaded APK is unavailable");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            JSObject result = new JSObject();
            result.put("permissionRequired", true);
            call.resolve(result);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(uri, "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installer);
            JSObject result = new JSObject();
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open Android installer", error);
        }
    }
}
