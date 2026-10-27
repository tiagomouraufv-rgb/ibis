package com.tiago.leitorpesquisa;

/**
 * Janela extra do app (DeX, tela dividida do Android): cada uma é uma tarefa separada, então dá para
 * ter uma no tablet e outras no monitor. Mostra o mesmo app; o "voltar" sem nada aberto fecha a janela.
 */
public class DocWindowActivity extends MainActivity {
    @Override
    protected boolean isExtraWindow() { return true; }
}
