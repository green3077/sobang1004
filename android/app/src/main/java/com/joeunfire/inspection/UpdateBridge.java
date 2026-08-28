package com.joeunfire.inspection;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// 앱 업데이트: 새 APK를 앱 캐시 폴더로 직접 내려받은 뒤(downloadAndInstall) 시스템 설치 화면을
// 띄운다. openExternal(구버전 방식, 외부 브라우저로 다운로드 URL만 열어줌)은 구버전 APK와의
// 호환을 위해 남겨둔다 - 이 새 플러그인 코드 자체가 없는 구버전 앱에서는 어차피 호출될 일이 없다.
@CapacitorPlugin(name = "UpdateBridge")
public class UpdateBridge extends Plugin {
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // Capacitor는 플러그인 메서드를 기본적으로 백그라운드 스레드에서 실행하므로(UI 스레드 아님),
    // 여기서 네트워크 다운로드를 동기적으로 처리해도 앱이 멈추지 않는다. 다운로드 도중 진행률을
    // "downloadProgress" 이벤트로 JS 쪽에 계속 알려준다(추정치라 서버가 Content-Length를 안 주면
    // 퍼센트 계산은 건너뛴다).
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        File outFile = new File(getContext().getCacheDir(), "update.apk");
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.connect();
            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                call.reject("다운로드 실패: HTTP " + status);
                return;
            }
            int total = conn.getContentLength();
            long readSoFar = 0;
            int lastPercent = -1;
            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(outFile)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    readSoFar += read;
                    if (total > 0) {
                        int percent = (int) (readSoFar * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }
            }
        } catch (Exception e) {
            call.reject("다운로드 실패: " + e.getMessage());
            return;
        } finally {
            if (conn != null) conn.disconnect();
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", outFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installIntent);
            call.resolve();
        } catch (Exception e) {
            call.reject("설치 화면을 여는 데 실패했습니다: " + e.getMessage());
        }
    }
}
