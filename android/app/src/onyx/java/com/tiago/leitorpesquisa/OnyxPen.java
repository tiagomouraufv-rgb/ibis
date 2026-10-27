package com.tiago.leitorpesquisa;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;

import com.onyx.android.sdk.data.note.TouchPoint;
import com.onyx.android.sdk.pen.RawInputCallback;
import com.onyx.android.sdk.pen.TouchHelper;
import com.onyx.android.sdk.pen.data.TouchPointList;

import org.json.JSONArray;
import org.json.JSONObject;
import org.lsposed.hiddenapibypass.HiddenApiBypass;

import java.util.List;
import java.util.Locale;

/**
 * Caneta rápida da Boox (SDK da Onyx). O traço aparece na tela de e-ink direto pelo sistema da Boox,
 * sem esperar o WebView; ao terminar o traço, os pontos vão para o app web, que guarda a anotação.
 * Experimental: se algo falhar, o app volta para a caneta comum.
 */
final class OnyxPen {
    interface Sink { void stroke(String json); }

    private static Boolean avail;
    private final View view;
    private final Sink sink;
    private final float density;
    private TouchHelper helper;
    private boolean open;

    OnyxPen(View view, Sink sink, float density) {
        this.view = view; this.sink = sink; this.density = density;
    }

    static boolean available() {
        if (avail != null) return avail;
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(Locale.ROOT);
        boolean ok = m.contains("onyx") || m.contains("boox");
        if (ok) {
            try {
                Class.forName("com.onyx.android.sdk.pen.TouchHelper");
                // o SDK usa funções internas do Android; a partir do Android 9 é preciso liberar o acesso
                if (Build.VERSION.SDK_INT >= 28) HiddenApiBypass.addHiddenApiExemptions("");
            } catch (Throwable t) { ok = false; }
        }
        avail = ok;
        return ok;
    }

    void start(Rect limit, List<Rect> exclude, float width) {
        if (helper == null) helper = TouchHelper.create(view, callback);
        helper.setStrokeWidth(width);
        helper.setStrokeStyle(TouchHelper.STROKE_STYLE_PENCIL);
        helper.setLimitRect(limit, exclude);
        if (!open) { helper.openRawDrawing(); open = true; }
        helper.setRawDrawingEnabled(true);
    }

    void enable(boolean on) {
        if (helper != null && open) helper.setRawDrawingEnabled(on);
    }

    void stop() {
        if (helper != null && open) {
            helper.setRawDrawingEnabled(false);
            helper.closeRawDrawing();
            open = false;
        }
    }

    private void send(TouchPointList list, boolean erase) {
        try {
            JSONArray pts = new JSONArray();
            for (TouchPoint p : list.getPoints()) {
                JSONArray q = new JSONArray();
                q.put(p.x / density); q.put(p.y / density); q.put(p.pressure); q.put(p.timestamp);
                pts.put(q);
            }
            JSONObject o = new JSONObject();
            o.put("pts", pts);
            o.put("erase", erase);
            sink.stroke(o.toString());
        } catch (Exception ignored) { }
    }

    private final RawInputCallback callback = new RawInputCallback() {
        @Override public void onBeginRawDrawing(boolean b, TouchPoint p) { }
        @Override public void onEndRawDrawing(boolean b, TouchPoint p) { }
        @Override public void onRawDrawingTouchPointMoveReceived(TouchPoint p) { }
        @Override public void onRawDrawingTouchPointListReceived(TouchPointList l) { send(l, false); }
        @Override public void onBeginRawErasing(boolean b, TouchPoint p) { }
        @Override public void onEndRawErasing(boolean b, TouchPoint p) { }
        @Override public void onRawErasingTouchPointMoveReceived(TouchPoint p) { }
        @Override public void onRawErasingTouchPointListReceived(TouchPointList l) { send(l, true); }
    };
}
