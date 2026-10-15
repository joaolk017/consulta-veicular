package br.com.consultaveicular360.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String SITE = "https://consultaveicular360.com.br/";
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private FrameLayout holder;

    private int px(float dp) { return (int)(getResources().getDisplayMetrics().density * dp + 0.5f); }
    private Button actionButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(13, 114, 189)));
        return b;
    }
    private void launchSite() {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(SITE))); }
        catch (Exception e) { Toast.makeText(this, "Não foi possível abrir o navegador.", Toast.LENGTH_LONG).show(); }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(7, 29, 55));
        getWindow().setNavigationBarColor(Color.rgb(7, 29, 55));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(px(16), px(8), px(8), px(8));
        bar.setBackgroundColor(Color.rgb(7, 34, 65));
        TextView title = new TextView(this);
        title.setText("CONSULTA VEICULAR 360");
        title.setTextSize(17);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(Color.WHITE);
        bar.addView(title, new LinearLayout.LayoutParams(0, px(46), 1f));
        title.setGravity(Gravity.CENTER_VERTICAL);
        TextView reload = new TextView(this);
        reload.setText("⟳");
        reload.setTextSize(29);
        reload.setGravity(Gravity.CENTER);
        reload.setTextColor(Color.WHITE);
        reload.setContentDescription("Atualizar a página");
        reload.setOnClickListener(v -> web.reload());
        bar.addView(reload, new LinearLayout.LayoutParams(px(54), px(48)));
        root.addView(bar);

        holder = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
                if ("https".equals(uri.getScheme()) &&
                    (host.equals("consultaveicular360.com.br") || host.equals("www.consultaveicular360.com.br"))) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Link indisponível.", Toast.LENGTH_SHORT).show(); }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                progress.setVisibility(View.VISIBLE);
                errorPanel.setVisibility(View.GONE);
            }
            @Override public void onPageFinished(WebView view, String url) { progress.setVisibility(View.GONE); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { progress.setVisibility(View.GONE); errorPanel.setVisibility(View.VISIBLE); }
            }
        });
        holder.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(-1, px(3), Gravity.TOP);
        holder.addView(progress, pp);
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(px(24), px(24), px(24), px(24));
        errorPanel.setBackgroundColor(Color.WHITE);
        TextView offline = new TextView(this);
        offline.setText("Não foi possível carregar o Consulta Veicular 360. Verifique sua conexão ou a disponibilidade do servidor.");
        offline.setTextSize(17);
        offline.setTextColor(Color.rgb(20, 35, 56));
        offline.setGravity(Gravity.CENTER);
        errorPanel.addView(offline);
        Button retry = actionButton("Tentar novamente");
        retry.setOnClickListener(v -> web.reload());
        errorPanel.addView(retry);
        Button browser = actionButton("Abrir no navegador");
        browser.setOnClickListener(v -> launchSite());
        errorPanel.addView(browser);
        holder.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel.setVisibility(View.GONE);
        root.addView(holder, new LinearLayout.LayoutParams(-1, 0, 1f));

        LinearLayout footer = new LinearLayout(this);
        footer.setGravity(Gravity.CENTER_VERTICAL);
        footer.setPadding(px(10), px(2), px(10), px(2));
        footer.setBackgroundColor(Color.rgb(7, 34, 65));
        TextView note = new TextView(this);
        note.setText("Versão de teste");
        note.setTextColor(Color.WHITE);
        note.setTextSize(13);
        footer.addView(note, new LinearLayout.LayoutParams(0, px(48), 1f));
        TextView browserAction = new TextView(this);
        browserAction.setText("Abrir site ↗");
        browserAction.setTextColor(Color.rgb(92, 205, 250));
        browserAction.setTextSize(14);
        browserAction.setGravity(Gravity.CENTER);
        browserAction.setOnClickListener(v -> launchSite());
        footer.addView(browserAction, new LinearLayout.LayoutParams(px(110), px(48)));
        root.addView(footer);
        setContentView(root);
        web.loadUrl(SITE + "?origem=android-teste");
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
