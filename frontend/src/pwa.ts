import { registerSW } from 'virtual:pwa-register';

/**
 * Registra o serviço da PWA no build de produção.
 *
 * O evento `compasso:update-ready` disponibiliza `detail.applyUpdate()`.
 * A interface deve chamar essa função apenas após confirmação e com formulários
 * salvos: aplicá-la pode recarregar a página. Nenhuma atualização força recarga.
 */
export function registerAppWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;

  const applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent('compasso:update-ready', {
          detail: { applyUpdate: () => applyUpdate(true) },
        }),
      );
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('compasso:offline-ready'));
    },
    onRegisterError() {
      // A interface continua funcionando com IndexedDB mesmo se o navegador
      // impedir o serviço. Sem registro, reabrir a aplicação offline não é garantido.
      window.dispatchEvent(new CustomEvent('compasso:offline-unavailable'));
    },
  });
}
