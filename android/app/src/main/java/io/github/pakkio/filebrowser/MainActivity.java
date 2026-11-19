package io.github.pakkio.filebrowser;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Thin shell around the File Browser web app. The server address is asked for on first launch
 * and kept on the device; nothing about any particular server is built into the app.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "filebrowser";
    private static final String KEY_URL = "server_url";

    private SharedPreferences prefs;
    private WebView web;
    private View errorView;
    private TextView errorText;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1E1E1E);
        setContentView(root);

        web = new WebView(this);
        web.setBackgroundColor(0xFF1E1E1E);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildErrorView();
        configureWebView();

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            return;
        }
        String url = prefs.getString(KEY_URL, null);
        if (url == null) {
            askForServer(false);
        } else {
            web.loadUrl(url);
        }
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " FileBrowserApp/1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                Uri server = Uri.parse(prefs.getString(KEY_URL, "about:blank"));
                boolean sameHost = target.getHost() != null && target.getHost().equalsIgnoreCase(server.getHost());
                if (sameHost || "blob".equals(target.getScheme()) || "data".equals(target.getScheme())) {
                    return false;
                }
                // Anything outside the server (links to other sites) opens in the real browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, R.string.cannot_open_link, Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loadFailed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                errorView.setVisibility(loadFailed ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    errorText.setText(getString(R.string.cannot_reach, prefs.getString(KEY_URL, ""), error.getDescription()));
                    errorView.setVisibility(View.VISIBLE);
                }
            }
        });

        // Fullscreen video from the page's own fullscreen button
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        // Downloads (mega.nz files, anything served as an attachment) go to the Downloads folder
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                req.setMimeType(mimeType);
                req.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) req.addRequestHeader("Cookie", cookies);
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, getString(R.string.downloading, name), Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(0xFF1E1E1E);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);

        errorText = new TextView(this);
        errorText.setTextColor(0xFFD4D4D4);
        errorText.setTextSize(16);
        errorText.setGravity(Gravity.CENTER);
        box.addView(errorText);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            web.reload();
        });
        box.addView(retry);

        Button change = new Button(this);
        change.setText(R.string.change_server);
        change.setOnClickListener(v -> askForServer(true));
        box.addView(change);

        errorView = box;
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Turn "192.168.1.10:3000" into "http://192.168.1.10:3000/". Returns null if it is not an address. */
    static String normalizeUrl(String input) {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty() || s.contains(" ")) return null;
        if (!s.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*")) s = "http://" + s;
        Uri uri = Uri.parse(s);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        if (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) return null;
        return s.endsWith("/") ? s : s + "/";
    }

    private void askForServer(boolean cancelable) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint(R.string.server_hint);
        input.setSingleLine(true);
        input.setText(prefs.getString(KEY_URL, ""));
        input.setSelection(input.getText().length());

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(R.string.server_title)
                .setMessage(R.string.server_message)
                .setView(input)
                .setCancelable(cancelable)
                .setPositiveButton(R.string.connect, null);
        if (cancelable) b.setNegativeButton(android.R.string.cancel, null);
        AlertDialog dialog = b.create();
        dialog.show();
        // Set here so an invalid address keeps the dialog open instead of dismissing it
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String url = normalizeUrl(input.getText().toString());
            if (url == null) {
                input.setError(getString(R.string.invalid_address));
                return;
            }
            prefs.edit().putString(KEY_URL, url).apply();
            errorView.setVisibility(View.GONE);
            web.loadUrl(url);
            dialog.dismiss();
        });
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            new AlertDialog.Builder(this)
                    .setItems(new CharSequence[]{getString(R.string.change_server), getString(R.string.exit)}, (d, which) -> {
                        if (which == 0) askForServer(true); else finish();
                    })
                    .show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
