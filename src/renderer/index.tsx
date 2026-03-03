import { SocketClient } from "@shared/back/SocketClient";
import { BackIn } from "@shared/back/types";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { HashRouter } from "react-router-dom";
import App from "./app";
import { ContextReducerProvider } from "./context-reducer/ContextReducerProvider";
import { PreferencesContextProvider } from "./context/PreferencesContext";
import { ProgressContext } from "./context/ProgressContext";
import store from "./redux/store";

function logFactory(socketServer: SocketClient<WebSocket>): LogFunc {
    return function (source: string, content: string) {
        socketServer.send(BackIn.ADD_LOG, {
            source: source,
            content: content
        });
        return {
            source: source,
            content: content,
            timestamp: Date.now(),
        };
    };
}

// HACK: Steam Deck OSK delivers each keypress twice (once via X11 uinput, once via
// the Wayland text-input protocol). Intercept in capture phase and drop the duplicate
// if the same key fires again within 35ms.
function deduplicateSteamDeckOskInput() {
    const recentKeyTimes = new Map<string, number>();
    window.addEventListener("keydown", (event) => {
        if (event.repeat) { return; }
        const now = Date.now();
        const last = recentKeyTimes.get(event.code) ?? 0;
        if (now - last < 35) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        recentKeyTimes.set(event.code, now);
    }, true);
}

(async () => {
    deduplicateSteamDeckOskInput();

    // Toggle DevTools when CTRL+SHIFT+I is pressed
    window.addEventListener("keypress", (event) => {
        if (event.ctrlKey && event.shiftKey && event.code === "KeyI") {
            window.External.toggleDevtools();
            event.preventDefault();
        }
    });

    await window.External.waitUntilInitialized();

    // Add global logging func
    window.log = logFactory(window.External.back);

    const root = ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement
    );
    root.render(
        <Provider store={store}>
            <PreferencesContextProvider>
                <ContextReducerProvider context={ProgressContext}>
                    <HashRouter>
                        <App />
                    </HashRouter>
                </ContextReducerProvider>
            </PreferencesContextProvider>
        </Provider>
    );
})();

