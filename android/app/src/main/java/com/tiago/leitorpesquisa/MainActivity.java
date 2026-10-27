package com.tiago.leitorpesquisa;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityOptions;
import android.content.ClipDescription;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Point;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.os.PersistableBundle;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.Display;
import android.view.DragAndDropPermissions;
import android.view.DragEvent;
import android.view.KeyEvent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Leitor de Pesquisa: abre o app web (pasta assets/web) num WebView e oferece pontes nativas para
 * salvar e compartilhar arquivos, abrir links em outros apps, usar o microfone e a voz do Android.
 * Nenhum servidor é aberto: os arquivos do app são entregues direto do APK.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/web/index.html";
    private static final int REQ_FILES = 1;
    private static final int REQ_SAVE = 2;
    private static final int REQ_AUDIO = 3;
    private static final int REQ_DRIVE = 4;
    private static final int REQ_SYNC_DIR = 5;
    private static final String PREF_SYNC_TREE = "rmSyncTree";
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    private String pendingDriveId;

    private FrameLayout root;
    private WebView web;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private byte[] pendingSaveBytes;
    private String pendingSaveId;
    private String pendingSyncId;
    private String pendingFileJson;
    private boolean pageReady = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private Object backCallback;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private Chrome chrome;
    private boolean penButton = false;
    // todas as janelas abertas do app (DeX: uma no tablet, outras no monitor)
    private static final List<WeakReference<MainActivity>> WINDOWS = new CopyOnWriteArrayList<>();
    private static final String LEITOR_MIME = "application/x-leitor";
    private boolean pageKeys = false, volumeKeys = false;
    private OnyxPen pen;

    /** true nas janelas extras (DocWindowActivity): o "voltar" fecha a janela. */
    protected boolean isExtraWindow() { return false; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1D5A8A);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupEdgeToEdge();

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);   // permite inspecionar pelo chrome://inspect no PC
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new AssetHandler())
                .build();
        web.setWebViewClient(new Client());
        chrome = new Chrome();
        web.setWebChromeClient(chrome);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        tts = new TextToSpeech(this, status -> ttsReady = (status == TextToSpeech.SUCCESS));
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { if ("fim".equals(id)) js("window.__ttsDone&&window.__ttsDone()"); }
            @Override public void onError(String id) { js("window.__ttsDone&&window.__ttsDone()"); }
        });

        setupBack();
        setupDrop();
        WINDOWS.add(new WeakReference<>(this));
        String doc = getIntent() != null ? getIntent().getStringExtra("doc") : null;
        web.loadUrl(doc != null && !doc.isEmpty() ? START_URL + "?doc=" + Uri.encode(doc) : START_URL);
        handleIntent(getIntent());
    }

    // ---------- tela inteira, respeitando barra de status, navegação e teclado ----------
    private void setupEdgeToEdge() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
                v.setPadding(l, t, r, b);
                return WindowInsets.CONSUMED;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
                v.setPadding(l, t, r, b);
                return insets.consumeSystemWindowInsets();
            }
        });
    }

    // ---------- botão voltar: primeiro o app fecha janelas/painéis; se não houver nada, vai para o fundo ----------
    private void setupBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            OnBackInvokedCallback cb = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
            backCallback = cb;
        }
    }

    // Botão lateral da caneta (S Pen): o Android avisa aqui; o app web usa isso como borracha
    private void checkPen(MotionEvent ev) {
        if (ev == null || ev.getPointerCount() == 0) return;
        int tt = ev.getToolType(0);
        if (tt != MotionEvent.TOOL_TYPE_STYLUS && tt != MotionEvent.TOOL_TYPE_ERASER) return;
        int mask = MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_STYLUS_SECONDARY | MotionEvent.BUTTON_SECONDARY;
        boolean b = (ev.getButtonState() & mask) != 0;
        if (b != penButton) {
            penButton = b;
            if (web != null) web.evaluateJavascript("window.__penBtn=" + b + ";", null);
        }
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        checkPen(ev);
        return super.dispatchTouchEvent(ev);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        checkPen(ev);
        return super.dispatchGenericMotionEvent(ev);
    }

    // Botões de virar página (teclado, controle de slides, botões do Boox) e, se ligado, os de volume
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode(), dir = 0;
        if (pageKeys) {
            if (k == KeyEvent.KEYCODE_PAGE_DOWN) dir = 1;
            else if (k == KeyEvent.KEYCODE_PAGE_UP) dir = -1;
            else if (volumeKeys && k == KeyEvent.KEYCODE_VOLUME_DOWN) dir = 1;
            else if (volumeKeys && k == KeyEvent.KEYCODE_VOLUME_UP) dir = -1;
        }
        if (dir != 0) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) js("window.leitorApp&&window.leitorApp.pageKey(" + dir + ")");
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // DeX ligado/desligado, Fold aberto/fechado: o app web recalcula a forma da tela
    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        js("window.__devChanged&&window.__devChanged()");
    }

    private void handleBack() {
        if (customView != null && chrome != null) { chrome.onHideCustomView(); return; }
        web.evaluateJavascript("(window.leitorApp&&window.leitorApp.androidBack())?'1':'0'", v -> {
            if (!"\"1\"".equals(v)) { if (isExtraWindow()) finish(); else moveTaskToBack(true); }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();   // Android 12 ou anterior
    }

    // ---------- arquivos do app (assets/web) ----------
    private class AssetHandler implements WebViewAssetLoader.PathHandler {
        @Override
        public WebResourceResponse handle(String path) {
            String p = path;
            int q = p.indexOf('?');
            if (q >= 0) p = p.substring(0, q);
            if (p.isEmpty() || p.endsWith("/")) p = p + "index.html";
            try {
                InputStream in = getAssets().open(p);
                String mime = mimeOf(p);
                boolean text = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript");
                WebResourceResponse r = new WebResourceResponse(mime, text ? "utf-8" : null, in);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-cache");
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
            }
        }
    }

    private static String mimeOf(String p) {
        String n = p.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".webmanifest")) return "application/manifest+json";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".md")) return "text/markdown";
        return "application/octet-stream";
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (HOST.equals(u.getHost())) return false;
            openExternal(u.toString());   // sites, obsidian://, etc. abrem fora do app
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            deliverPending();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // o motor do WebView caiu (falta de memória, por exemplo): recria a tela
            root.removeView(web);
            web.destroy();
            recreate();
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        // vídeo (YouTube) em tela cheia
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
            }
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            web.setVisibility(View.VISIBLE);
            if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                getWindow().getInsetsController().show(WindowInsets.Type.systemBars());
            }
            if (customCallback != null) customCallback.onCustomViewHidden();
            customCallback = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            String joined = String.join(",", params.getAcceptTypes()).toLowerCase(Locale.ROOT);
            List<String> mimes = new ArrayList<>();
            if (joined.contains("pdf")) mimes.add("application/pdf");
            if (joined.contains("image")) mimes.add("image/*");
            // .md (Markdown, ex.: folhas do MathTi): muitos gerenciadores marcam como texto ou como "binário"
            if (joined.contains("markdown") || joined.contains(".md")) {
                mimes.add("text/*");
                mimes.add("application/octet-stream");
            }
            if (joined.contains("zip")) {
                mimes.add("application/zip");
                mimes.add("application/x-zip-compressed");
                mimes.add("application/octet-stream");
            }
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mimes.size() == 1 ? mimes.get(0) : "*/*");
            if (mimes.size() > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(i, REQ_FILES);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            for (String r : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingPermission = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                    }
                    return;
                }
            }
            request.deny();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_AUDIO && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingPermission.deny();
                toast("Sem permissão do microfone. Ative em Configurações do Android > Apps > Leitor > Permissões.");
            }
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILES) {
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData c = data.getClipData();
                    out = new Uri[c.getItemCount()];
                    for (int k = 0; k < c.getItemCount(); k++) out[k] = c.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(out);
            fileCallback = null;
        } else if (requestCode == REQ_DRIVE) {
            final String id = pendingDriveId;
            pendingDriveId = null;
            if (resultCode != RESULT_OK || data == null) {
                // o Google às vezes fecha a janela sozinho (cliente Android não reconhecido, conta sem permissão…):
                // tenta ler o motivo para mostrar o código
                String why = "";
                if (data != null) {
                    try { Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data); }
                    catch (ApiException e) { why = " (código " + e.getStatusCode() + (e.getMessage() != null ? ": " + e.getMessage() : "") + ")"; }
                    catch (Exception e) { why = " (" + e.getClass().getSimpleName() + ")"; }
                }
                jsCallback(id, false, "Login cancelado" + why + " [resultado " + resultCode + (data == null ? ", sem dados" : "") + "].");
                return;
            }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                if (r.getAccessToken() != null) jsCallback(id, true, r.getAccessToken());
                else jsCallback(id, false, "O Google não devolveu o acesso ao Drive.");
            } catch (ApiException e) {
                jsCallback(id, false, "Login recusado pelo Google (código " + e.getStatusCode() + "). Confira o cliente Android no Google Cloud (Guia > Sincronização).");
            }
        } else if (requestCode == REQ_SYNC_DIR) {
            final String id = pendingSyncId;
            pendingSyncId = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) { jsCallback(id, false, "Cancelado."); return; }
            Uri tree = data.getData();
            try {
                int fl = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try { getContentResolver().takePersistableUriPermission(tree, fl); }
                catch (SecurityException se) { getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            } catch (Exception e) {
                jsCallback(id, false, "O Android não deixou guardar o acesso à pasta: " + e.getMessage());
                return;
            }
            getSharedPreferences("leitor", MODE_PRIVATE).edit().putString(PREF_SYNC_TREE, tree.toString()).apply();
            jsCallback(id, true, syncTreeName(tree));
        } else if (requestCode == REQ_SAVE) {
            final String id = pendingSaveId;
            final byte[] bytes = pendingSaveBytes;
            pendingSaveId = null;
            pendingSaveBytes = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || bytes == null) {
                jsCallback(id, false, "Cancelado.");
                return;
            }
            final Uri uri = data.getData();
            io.execute(() -> {
                try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
                    if (os == null) throw new IOException("sem acesso ao destino");
                    os.write(bytes);
                    jsCallback(id, true, "");
                } catch (Exception e) {
                    jsCallback(id, false, "Erro ao salvar: " + e.getMessage());
                }
            });
        }
    }

    // ---------- PDF recebido ("Abrir com" / "Compartilhar") ----------
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri u = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) u = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) u = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            else u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            // texto compartilhado de outro app (ex.: resposta do Acrobat ou do NotebookLM): vira nota no app
            CharSequence txt = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (u == null && txt != null && txt.length() > 0) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("text", txt.toString());
                    String subj = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                    if (subj != null) o.put("subject", subj);
                    synchronized (MainActivity.this) { pendingFileJson = o.toString(); }
                    deliverPending();
                } catch (Exception ignored) { }
                return;
            }
        }
        if (u == null) return;
        final Uri uri = u;
        io.execute(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("arquivo indisponível");
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                JSONObject o = new JSONObject();
                o.put("name", displayName(uri));
                o.put("b64", Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                synchronized (MainActivity.this) { pendingFileJson = o.toString(); }
                runOnUiThread(this::deliverPending);
            } catch (Exception e) {
                toast("Não foi possível ler o arquivo: " + e.getMessage());
            }
        });
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String s = c.getString(0);
                if (s != null) return s;
            }
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last != null ? last : "documento.pdf";
    }

    private void deliverPending() {
        boolean has;
        synchronized (this) { has = pendingFileJson != null; }
        if (pageReady && has) js("window.__nativePending&&window.__nativePending()");
    }

    // ---------- arrastar e soltar entre janelas (DeX) e de outros apps ----------
    private void setupDrop() {
        web.setOnDragListener((v, ev) -> {
            ClipDescription d = ev.getClipDescription();
            boolean ours = d != null && d.hasMimeType(LEITOR_MIME);
            boolean image = d != null && d.hasMimeType("image/*");
            // texto comum de outros apps: deixa o próprio WebView cuidar (colar no campo, etc.)
            if (!ours && !image) return false;
            if (ev.getAction() == DragEvent.ACTION_DROP) { onDrop(ev, ours); }
            return true;
        });
    }

    private void onDrop(DragEvent ev, boolean ours) {
        final float dens = getResources().getDisplayMetrics().density;
        final float x = ev.getX() / dens, y = ev.getY() / dens;
        ClipData c = ev.getClipData();
        if (c == null || c.getItemCount() == 0) return;
        String json = "";
        ClipDescription d = c.getDescription();
        if (ours && d != null && d.getExtras() != null) json = d.getExtras().getString("leitor", "");
        ClipData.Item it = c.getItemAt(0);
        final Uri uri = it.getUri();
        if (json.isEmpty() && it.getText() != null) {
            try { json = new JSONObject().put("kind", "text").put("text", it.getText().toString()).toString(); } catch (Exception ignored) { }
        }
        final String fj = json;
        if (uri == null) { nativeDrop(x, y, fj, "", ""); return; }
        DragAndDropPermissions perm = null;
        try { perm = requestDragAndDropPermissions(ev); } catch (Exception ignored) { }
        final DragAndDropPermissions fp = perm;
        io.execute(() -> {
            String b64 = "", mime = "";
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in != null) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 25_000_000) break; }
                    b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                    String t = getContentResolver().getType(uri);
                    mime = t != null ? t : "image/png";
                }
            } catch (Exception e) {
                toast("Não consegui ler o que foi solto: " + e.getMessage());
            } finally {
                if (fp != null) runOnUiThread(fp::release);
            }
            nativeDrop(x, y, fj, b64, mime);
        });
    }

    private void nativeDrop(float x, float y, String json, String b64, String mime) {
        js("window.__nativeDrop&&window.__nativeDrop(" + x + "," + y + "," + JSONObject.quote(json) + "," + JSONObject.quote(b64) + "," + JSONObject.quote(mime) + ")");
    }

    // começa um arrastar do sistema (passa para outras janelas do app e para outros apps)
    private boolean beginDrag(String json, String b64) throws Exception {
        JSONObject o = new JSONObject(json);
        String text = o.optString("text", "");
        Uri uri = null;
        Bitmap thumb = null;
        if (b64 != null && !b64.isEmpty()) {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            File dir = new File(getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("sem espaço");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (f.getName().startsWith("arrastar-")) //noinspection ResultOfMethodCallIgnored
                f.delete();
            File f = new File(dir, "arrastar-" + System.currentTimeMillis() + ".png");
            try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
            uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            BitmapFactory.Options op = new BitmapFactory.Options();
            op.inSampleSize = 2;
            thumb = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, op);
        }
        String[] mimes = uri != null ? new String[]{LEITOR_MIME, "image/png"} : new String[]{LEITOR_MIME, ClipDescription.MIMETYPE_TEXT_PLAIN};
        ClipDescription desc = new ClipDescription("Leitor de Pesquisa", mimes);
        PersistableBundle extra = new PersistableBundle();
        extra.putString("leitor", json);
        desc.setExtras(extra);
        ClipData clip = new ClipData(desc, new ClipData.Item(text.isEmpty() ? null : text, null, uri));
        int flags = View.DRAG_FLAG_GLOBAL | View.DRAG_FLAG_GLOBAL_URI_READ;
        return web.startDragAndDrop(clip, new Shadow(thumb, text), null, flags);
    }

    // a "sombra" que acompanha o dedo: a figura reduzida ou o começo do texto
    private class Shadow extends View.DragShadowBuilder {
        private final Bitmap bmp; private final String text; private final int w, hgt;
        Shadow(Bitmap bmp, String text) {
            this.bmp = bmp; this.text = text.length() > 120 ? text.substring(0, 120) + "…" : text;
            float d = getResources().getDisplayMetrics().density;
            if (bmp != null) {
                float k = Math.min(1f, 200 * d / Math.max(bmp.getWidth(), bmp.getHeight()));
                w = Math.max(1, Math.round(bmp.getWidth() * k)); hgt = Math.max(1, Math.round(bmp.getHeight() * k));
            } else { w = Math.round(240 * d); hgt = Math.round(72 * d); }
        }
        @Override public void onProvideShadowMetrics(Point size, Point touch) { size.set(w, hgt); touch.set(w / 2, hgt / 2); }
        @Override public void onDrawShadow(Canvas c) {
            if (bmp != null) { c.drawBitmap(bmp, null, new Rect(0, 0, w, hgt), new Paint(Paint.FILTER_BITMAP_FLAG)); return; }
            Paint bg = new Paint(); bg.setColor(0xF0FFFFFF); c.drawRoundRect(0, 0, w, hgt, 16, 16, bg);
            Paint br = new Paint(); br.setColor(0xFF1D5A8A); br.setStyle(Paint.Style.STROKE); br.setStrokeWidth(3); c.drawRoundRect(1, 1, w - 1, hgt - 1, 16, 16, br);
            TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG); tp.setColor(0xFF16191D); tp.setTextSize(13 * getResources().getDisplayMetrics().density);
            StaticLayout sl = StaticLayout.Builder.obtain(text, 0, text.length(), tp, w - 24).setMaxLines(3).setEllipsize(android.text.TextUtils.TruncateAt.END).setAlignment(Layout.Alignment.ALIGN_NORMAL).build();
            c.save(); c.translate(12, 10); sl.draw(c); c.restore();
        }
    }

    // ---------- janelas ----------
    private void openWindow(String docId) {
        Intent i = new Intent(this, DocWindowActivity.class);
        if (docId != null && !docId.isEmpty()) i.putExtra("doc", docId);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT
                | Intent.FLAG_ACTIVITY_MULTIPLE_TASK | Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT);
        // DeX com monitor: se houver outra tela, a nova janela abre nela
        Display other = otherDisplay();
        if (other != null) {
            try {
                ActivityOptions ao = ActivityOptions.makeBasic();
                ao.setLaunchDisplayId(other.getDisplayId());
                startActivity(i, ao.toBundle());
                return;
            } catch (Exception e) { /* o sistema não deixou: abre na tela atual */ }
        }
        try { startActivity(i); } catch (Exception e) { toast("Não foi possível abrir outra janela: " + e.getMessage()); }
    }

    @SuppressWarnings("deprecation")
    private Display otherDisplay() {
        DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (dm == null) return null;
        Display mine = Build.VERSION.SDK_INT >= 30 ? getDisplay() : getWindowManager().getDefaultDisplay();
        int myId = mine != null ? mine.getDisplayId() : Display.DEFAULT_DISPLAY;
        for (Display d : dm.getDisplays()) {
            if (d.getDisplayId() == myId || d.getState() != Display.STATE_ON) continue;
            if ((d.getFlags() & Display.FLAG_PRIVATE) != 0) continue;
            return d;
        }
        return null;
    }

    private static boolean dexOn(Configuration c) {
        // Samsung DeX: campos próprios da Samsung na Configuration (lidos por reflexão; em outros aparelhos não existem)
        try {
            Class<?> k = c.getClass();
            int on = k.getField("SEM_DESKTOP_MODE_ENABLED").getInt(k);
            int cur = k.getField("semDesktopModeEnabled").getInt(c);
            return on == cur;
        } catch (Throwable t) { return false; }
    }

    private void relay(String json) {
        String code = "window.__winMsg&&window.__winMsg(" + JSONObject.quote(json) + ")";
        for (WeakReference<MainActivity> w : WINDOWS) {
            MainActivity a = w.get();
            if (a == null) { WINDOWS.remove(w); continue; }
            if (a != this) a.js(code);
        }
    }

    // ---------- caneta rápida da Boox ----------
    private void penStart(String json) {
        try {
            JSONObject o = new JSONObject(json);
            float d = getResources().getDisplayMetrics().density;
            Rect lim = new Rect(Math.round((float) o.getDouble("l") * d), Math.round((float) o.getDouble("t") * d),
                    Math.round((float) o.getDouble("r") * d), Math.round((float) o.getDouble("b") * d));
            List<Rect> ex = new ArrayList<>();
            JSONArray a = o.optJSONArray("ex");
            if (a != null) for (int k = 0; k < a.length(); k++) {
                JSONArray q = a.getJSONArray(k);
                ex.add(new Rect(Math.round((float) q.getDouble(0) * d), Math.round((float) q.getDouble(1) * d), Math.round((float) q.getDouble(2) * d), Math.round((float) q.getDouble(3) * d)));
            }
            if (pen == null) pen = new OnyxPen(web, s -> js("window.__fastInk&&window.__fastInk(" + JSONObject.quote(s) + ")"), d);
            pen.start(lim, ex, (float) o.optDouble("w", 2) * d);
        } catch (Throwable t) {
            pen = null;
            js("window.__fastPenFailed&&window.__fastPenFailed(" + JSONObject.quote(String.valueOf(t)) + ")");
        }
    }

    // ---------- pontes chamadas pelo app (JavaScript) ----------
    private class Bridge {
        // Login do Google para o Drive (sincronização). interactive=false: só renova sem mostrar nada.
        @JavascriptInterface
        public void driveToken(String id, boolean interactive) {
            runOnUiThread(() -> {
                AuthorizationRequest req = AuthorizationRequest.builder()
                        .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_SCOPE)))
                        .build();
                Identity.getAuthorizationClient(MainActivity.this).authorize(req)
                        .addOnSuccessListener(res -> {
                            if (res.hasResolution()) {
                                if (!interactive || res.getPendingIntent() == null) { jsCallback(id, false, "need-consent"); return; }
                                try {
                                    pendingDriveId = id;
                                    startIntentSenderForResult(res.getPendingIntent().getIntentSender(), REQ_DRIVE, null, 0, 0, 0, null);
                                } catch (IntentSender.SendIntentException e) {
                                    pendingDriveId = null;
                                    jsCallback(id, false, "Não consegui abrir o login: " + e.getMessage());
                                }
                            } else {
                                jsCallback(id, true, res.getAccessToken());
                            }
                        })
                        .addOnFailureListener(e -> jsCallback(id, false, "Falha no login do Google: " + e.getMessage()));
            });
        }

        @JavascriptInterface
        public void saveFile(String id, String b64, String name, String mime) {
            final byte[] bytes;
            try { bytes = Base64.decode(b64, Base64.DEFAULT); } catch (Exception e) { jsCallback(id, false, "Arquivo inválido."); return; }
            runOnUiThread(() -> {
                if (pendingSaveId != null) jsCallback(pendingSaveId, false, "Cancelado.");
                pendingSaveId = id;
                pendingSaveBytes = bytes;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSaveId = null;
                    pendingSaveBytes = null;
                    jsCallback(id, false, "Não foi possível abrir o “Salvar como”.");
                }
            });
        }

        @JavascriptInterface
        public void syncPickFolder(String id) {
            runOnUiThread(() -> {
                if (pendingSyncId != null) jsCallback(pendingSyncId, false, "Cancelado.");
                pendingSyncId = id;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {
                    startActivityForResult(i, REQ_SYNC_DIR);
                } catch (ActivityNotFoundException e) {
                    pendingSyncId = null;
                    jsCallback(id, false, "Este Android não tem o seletor de pastas.");
                }
            });
        }

        @JavascriptInterface
        public String syncFolderName() {
            Uri t = syncTree();
            return t == null ? "" : syncTreeName(t);
        }

        @JavascriptInterface
        public void syncForget() {
            Uri t = syncTree();
            if (t != null) try { getContentResolver().releasePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) {
                try { getContentResolver().releasePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored2) { }
            }
            getSharedPreferences("leitor", MODE_PRIVATE).edit().remove(PREF_SYNC_TREE).apply();
        }

        @JavascriptInterface
        public void syncWriteFile(String id, String name, String text) {
            io.execute(() -> {
                try { syncWrite(name, text); jsCallback(id, true, ""); }
                catch (Exception e) { jsCallback(id, false, e.getMessage() == null ? "erro ao gravar na pasta" : e.getMessage()); }
            });
        }

        @JavascriptInterface
        public void syncListNames(String id) {
            io.execute(() -> {
                try {
                    Uri tree = syncTree();
                    if (tree == null) throw new IOException("nenhuma pasta escolhida");
                    Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    JSONArray out = new JSONArray();
                    try (Cursor c = getContentResolver().query(kids, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
                        if (c == null) throw new IOException("sem acesso à pasta (escolha de novo)");
                        while (c.moveToNext()) {
                            JSONObject o = new JSONObject();
                            o.put("name", c.getString(0));
                            o.put("mtime", c.isNull(1) ? 0 : c.getLong(1));
                            o.put("size", c.isNull(2) ? 0 : c.getLong(2));
                            out.put(o);
                        }
                    }
                    jsCallback(id, true, out.toString());
                } catch (Exception e) { jsCallback(id, false, e.getMessage() == null ? "erro ao ler a pasta" : e.getMessage()); }
            });
        }

        // apaga UM arquivo da pasta escolhida (só nomes simples; quem decide quais é o app, depois de você confirmar)
        @JavascriptInterface
        public void syncDeleteFile(String id, String name) {
            io.execute(() -> {
                try {
                    if (name == null || !name.matches("[A-Za-z0-9_.~ -]+") || name.contains("..")) throw new IOException("nome de arquivo inválido");
                    Uri tree = syncTree();
                    if (tree == null) throw new IOException("nenhuma pasta escolhida");
                    Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    Uri target = null;
                    try (Cursor c = getContentResolver().query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                        if (c != null) while (c.moveToNext()) if (name.equals(c.getString(1))) { target = DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)); break; }
                    }
                    if (target == null) { jsCallback(id, true, "já não existia"); return; }
                    if (!DocumentsContract.deleteDocument(getContentResolver(), target)) throw new IOException("o Android não apagou");
                    jsCallback(id, true, "");
                } catch (Exception e) { jsCallback(id, false, e.getMessage() == null ? "erro ao apagar" : e.getMessage()); }
            });
        }

        @JavascriptInterface
        public void syncReadFiles(String id) {
            io.execute(() -> {
                try { jsCallback(id, true, syncReadAll()); }
                catch (Exception e) { jsCallback(id, false, e.getMessage() == null ? "erro ao ler a pasta" : e.getMessage()); }
            });
        }

        @JavascriptInterface
        public void shareFile(String b64, String name, String mime) {
            try {
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("sem espaço");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                File f = new File(dir, safe);
                try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(Base64.decode(b64, Base64.DEFAULT)); }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.putExtra(Intent.EXTRA_TITLE, name);
                i.setClipData(ClipData.newRawUri(name, uri));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(i, "Compartilhar " + name)));
            } catch (Exception e) {
                toast("Não foi possível compartilhar: " + e.getMessage());
            }
        }

        // vários arquivos de uma vez; pkg (opcional) = app de destino (Acrobat, NotebookLM). Se o app não estiver
        // instalado, abre o menu Compartilhar normal.
        @JavascriptInterface
        public void shareFiles(String json, String pkg) {
            try {
                JSONArray arr = new JSONArray(json);
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("sem espaço");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                ArrayList<Uri> uris = new ArrayList<>();
                String mime = null;
                ClipData clip = null;
                for (int k = 0; k < arr.length(); k++) {
                    JSONObject o = arr.getJSONObject(k);
                    String name = o.getString("name").replaceAll("[\\\\/:*?\"<>|]", "_");
                    File f = new File(dir, name);
                    try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(Base64.decode(o.getString("b64"), Base64.DEFAULT)); }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    uris.add(uri);
                    String m = o.optString("mime", "application/octet-stream");
                    mime = mime == null ? m : (mime.equals(m) ? mime : "*/*");
                    if (clip == null) clip = ClipData.newRawUri(name, uri); else clip.addItem(new ClipData.Item(uri));
                }
                if (uris.isEmpty()) return;
                Intent i;
                if (uris.size() == 1) { i = new Intent(Intent.ACTION_SEND); i.putExtra(Intent.EXTRA_STREAM, uris.get(0)); }
                else { i = new Intent(Intent.ACTION_SEND_MULTIPLE); i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris); }
                i.setType(mime);
                i.setClipData(clip);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent go = null;
                if (pkg != null && !pkg.isEmpty()) {
                    Intent t = new Intent(i); t.setPackage(pkg);
                    if (t.resolveActivity(getPackageManager()) != null) go = t;
                }
                final Intent fin = go != null ? go : Intent.createChooser(i, "Enviar para…");
                runOnUiThread(() -> {
                    try { startActivity(fin); }
                    catch (ActivityNotFoundException e) { startActivity(Intent.createChooser(i, "Enviar para…")); }
                });
            } catch (Exception e) {
                toast("Não foi possível compartilhar: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public boolean hasApp(String pkg) {
            try { getPackageManager().getPackageInfo(pkg, 0); return true; } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void shareText(String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, "Enviar para…")));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Leitor", text));
            });
        }

        @JavascriptInterface
        public void speak(String text, String lang, float rate) {
            if (!ttsReady) { toast("A voz do Android ainda não está pronta. Verifique em Configurações > Leitura em voz alta."); js("window.__ttsDone&&window.__ttsDone()"); return; }
            tts.stop();
            int res = tts.setLanguage(Locale.forLanguageTag(lang));
            if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                toast("Voz para " + lang + " não instalada; usando a voz padrão.");
            }
            tts.setSpeechRate(rate > 0 ? rate : 1f);
            int max = Math.max(500, TextToSpeech.getMaxSpeechInputLength() - 200);
            List<String> parts = new ArrayList<>();
            String rest = text;
            while (rest.length() > max) {
                int cut = rest.lastIndexOf(". ", max);
                if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
                if (cut <= 0) cut = max;
                parts.add(rest.substring(0, cut + 1));
                rest = rest.substring(cut + 1);
            }
            parts.add(rest);
            for (int k = 0; k < parts.size(); k++) {
                String id = (k == parts.size() - 1) ? "fim" : ("p" + k);
                tts.speak(parts.get(k), k == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
            }
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (tts != null) tts.stop();
        }

        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("manufacturer", Build.MANUFACTURER);
                o.put("brand", Build.BRAND);
                o.put("model", Build.MODEL);
                o.put("device", Build.DEVICE);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("release", Build.VERSION.RELEASE);
                o.put("dex", dexOn(getResources().getConfiguration()));
                o.put("otherDisplay", otherDisplay() != null);
                o.put("extraWindow", isExtraWindow());
                o.put("fastPen", OnyxPen.available());
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void newWindow(String docId) { runOnUiThread(() -> openWindow(docId)); }

        @JavascriptInterface
        public void broadcast(String json) { relay(json); }

        @JavascriptInterface
        public boolean startDrag(String json, String b64) {
            final boolean[] ok = {false};
            final CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(() -> {
                try { ok[0] = beginDrag(json, b64); } catch (Throwable t) { ok[0] = false; }
                done.countDown();
            });
            try { done.await(2, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return ok[0];
        }

        @JavascriptInterface
        public void setPageKeys(boolean on, boolean volume) { pageKeys = on; volumeKeys = volume; }

        @JavascriptInterface
        public boolean penSupported() { return OnyxPen.available(); }

        @JavascriptInterface
        public void penStart(String json) { runOnUiThread(() -> MainActivity.this.penStart(json)); }

        @JavascriptInterface
        public void penEnable(boolean on) { runOnUiThread(() -> { if (pen != null) try { pen.enable(on); } catch (Throwable ignored) { } }); }

        @JavascriptInterface
        public void penStop() { runOnUiThread(() -> { if (pen != null) try { pen.stop(); } catch (Throwable ignored) { } }); }

        @JavascriptInterface
        public String takePendingFile() {
            synchronized (MainActivity.this) {
                String s = pendingFileJson;
                pendingFileJson = null;
                return s;
            }
        }
    }

    // ---------- utilidades ----------
    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast(url.startsWith("obsidian:") ? "O app do Obsidian não está instalado." : "Nenhum app abre este endereço.");
        }
    }

    // ---------- pasta do Syncthing (arquivos de volta do reMarkable) ----------
    private Uri syncTree() {
        String t = getSharedPreferences("leitor", MODE_PRIVATE).getString(PREF_SYNC_TREE, null);
        return t == null ? null : Uri.parse(t);
    }

    private String syncTreeName(Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = getContentResolver().query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) return c.getString(0);
            }
        } catch (Exception ignored) { }
        String p = tree.getLastPathSegment();
        return p == null ? "pasta escolhida" : p;
    }

    // Lê os arquivos leitor-*.json da pasta (só leitura). Devolve [{name, mtime, text}]
    private String syncReadAll() throws Exception {
        Uri tree = syncTree();
        if (tree == null) throw new IOException("nenhuma pasta escolhida");
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        JSONArray out = new JSONArray();
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_SIZE};
        try (Cursor c = getContentResolver().query(kids, cols, null, null, null)) {
            if (c == null) throw new IOException("sem acesso à pasta (escolha de novo)");
            while (c.moveToNext()) {
                String name = c.getString(1);
                if (name == null || !name.startsWith("leitor-") || !name.endsWith(".json")) continue;
                if (!c.isNull(3) && c.getLong(3) > 20L * 1024 * 1024) continue;
                Uri f = DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                try (InputStream in = getContentResolver().openInputStream(f)) {
                    if (in == null) continue;
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                }
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("mtime", c.isNull(2) ? 0 : c.getLong(2));
                o.put("text", bo.toString("UTF-8"));
                out.put(o);
            }
        }
        return out.toString();
    }

    // Grava (ou troca) um arquivo da pasta escolhida. Só nomes simples (app-*.json).
    private void syncWrite(String name, String text) throws Exception {
        if (name == null || !name.matches("[A-Za-z0-9_.-]+")) throw new IOException("nome de arquivo inválido");
        Uri tree = syncTree();
        if (tree == null) throw new IOException("nenhuma pasta escolhida");
        String treeId = DocumentsContract.getTreeDocumentId(tree);
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, treeId);
        Uri target = null;
        try (Cursor c = getContentResolver().query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c == null) throw new IOException("sem acesso à pasta (escolha de novo)");
            while (c.moveToNext()) if (name.equals(c.getString(1))) { target = DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)); break; }
        }
        if (target == null) {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, treeId);
            target = DocumentsContract.createDocument(getContentResolver(), parent, "application/octet-stream", name);
            if (target == null) throw new IOException("não consegui criar o arquivo (escolha a pasta de novo, para o app poder gravar nela)");
        }
        try (OutputStream os = getContentResolver().openOutputStream(target, "wt")) {
            if (os == null) throw new IOException("sem permissão para gravar (escolha a pasta de novo)");
            os.write(text.getBytes("UTF-8"));
        } catch (SecurityException se) {
            throw new IOException("sem permissão para gravar (escolha a pasta de novo em Configurações > reMarkable)");
        }
    }

    void js(String code) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private void jsCallback(String id, boolean ok, String msg) {
        if (id == null) return;
        js("window.__nativeCb&&window.__nativeCb(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")");
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (pen != null) try { pen.enable(false); } catch (Throwable ignored) { }
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        js("window.__fastPenResume&&window.__fastPenResume()");
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
        }
        for (WeakReference<MainActivity> w : WINDOWS) if (w.get() == null || w.get() == this) WINDOWS.remove(w);
        if (pen != null) try { pen.stop(); } catch (Throwable ignored) { }
        if (tts != null) tts.shutdown();
        io.shutdown();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
