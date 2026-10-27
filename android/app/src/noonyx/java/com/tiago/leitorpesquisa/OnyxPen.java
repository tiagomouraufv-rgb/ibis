package com.tiago.leitorpesquisa;

import android.graphics.Rect;
import android.view.View;

import java.util.List;

/** Versão sem a biblioteca da Onyx (compilação com onyx=false): a caneta rápida fica indisponível. */
final class OnyxPen {
    interface Sink { void stroke(String json); }

    OnyxPen(View view, Sink sink, float density) { }

    static boolean available() { return false; }

    void start(Rect limit, List<Rect> exclude, float width) { throw new IllegalStateException("caneta rápida não incluída nesta compilação"); }

    void enable(boolean on) { }

    void stop() { }
}
