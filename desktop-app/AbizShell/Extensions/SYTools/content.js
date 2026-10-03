/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 1322:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.APP_NAME = exports.CONNECTION_STATE = exports.APP_ID = exports.AM_CONNECTION_ID_INITIAL = exports.APP_CONNECTION_ID = exports.SABY_DESKTOP_CONNECTION_ID = exports.EXTENSION_LOADED_ID = exports.TRACKING_ID = exports.BROADCAST_TAB_ID = void 0;
/**
 * Идентификатор для массовой рассылки сообщения на все вкладки
 */
exports.BROADCAST_TAB_ID = -1;
/**
 * Идентификатор для начальной проверки активности Плагина
 */
exports.TRACKING_ID = -111;
/**
 * Уникальный идентификатор сообщения о запуске плагина
 */
exports.EXTENSION_LOADED_ID = -30;
/**
 * Условный идентификатор порта для служебного соединения
 */
exports.SABY_DESKTOP_CONNECTION_ID = -40;
/**
 * Условный идентификатор порта для служебного соединения c приложением
 */
exports.APP_CONNECTION_ID = -41;
/**
 * Начальный идентификатор собщений ActivityMonitor
 * Должен иметь наменьшее значение, т.к. может динамически уменьшаться
 */
exports.AM_CONNECTION_ID_INITIAL = -120;
/**
 * Идентификаторы приложений
 * Нужны, чтобы распознавать, от какого приложения пришло сообщение
 */
var APP_ID;
(function (APP_ID) {
    APP_ID[APP_ID["Plugin"] = 101] = "Plugin";
    APP_ID[APP_ID["Admin"] = 102] = "Admin";
    APP_ID[APP_ID["Screen"] = 103] = "Screen";
    APP_ID[APP_ID["Cam"] = 104] = "Cam";
    APP_ID[APP_ID["Service"] = 105] = "Service";
})(APP_ID || (exports.APP_ID = APP_ID = {}));
/**
 * Состояние соединения
 */
var CONNECTION_STATE;
(function (CONNECTION_STATE) {
    /** Неизвестно */
    CONNECTION_STATE[CONNECTION_STATE["UNKNOWN"] = 0] = "UNKNOWN";
    /** Есть */
    CONNECTION_STATE[CONNECTION_STATE["ALIVE"] = 1] = "ALIVE";
    /** Нет */
    CONNECTION_STATE[CONNECTION_STATE["DEAD"] = 2] = "DEAD";
})(CONNECTION_STATE || (exports.CONNECTION_STATE = CONNECTION_STATE = {}));
/**
 * Список приложений
 */
var APP_NAME;
(function (APP_NAME) {
    APP_NAME["Plugin"] = "Plugin";
    APP_NAME["Admin"] = "Admin";
    APP_NAME["Cam"] = "Cam";
    APP_NAME["Screen"] = "Screen";
})(APP_NAME || (exports.APP_NAME = APP_NAME = {}));


/***/ }),

/***/ 2830:
/***/ (() => {


/**
 * Контентный скрипт
 * Контентный скрипт подключается к главной странице автоматически,
 * если её домен совпадает со списком разрешений из manifest.json
 * Контентный скрипт загружается до загрузки главной страницы (см. content_scripts[0].run_at в manifest.json)
 *
 * WARNING!!!
 * Фоновая страница может посылать сообщения контентным скриптам при помощи метода chrome.tabs.sendMessage()
 * (см. https://developer.chrome.com/extensions/tabs#method-sendMessage) с явным указанием в какую вкладку отправлять.
 * Но сообщение отправляется всем вкладкам данного расширения!! А узнать номер своей вкладки напрямую контентный
 * скрипт не может (см. https://developer.chrome.com/extensions/content_scripts).
 *
 * Номер вкладки будет получен следующим образом: при передаче данных в фоновую страницу в chrome.runtime.sendMessage()
 * (см. https://developer.chrome.com/extensions/runtime#method-sendMessage) назначается обработчик responseCallback,
 * которому возращается номер вкладки через sendResponse из обработчика события chrome.runtime.onMessage фоновой страницы
 * (см. https://developer.chrome.com/extensions/runtime#event-onMessage).
 *
 * @author Есин А.И.
 */
// Если страница уже загружена, то внедряем скрипты сразу. Либо дожидаемся загрузки DOM
document.addEventListener('DOMContentLoaded', injectExtensionInfoToPage);
if (document.readyState === 'complete') {
    injectExtensionInfoToPage();
}
/**
 * @brief Внедрение информациии о расширении в главную страницу
 * Как проверить наличие расширения SBIS Plugin Extension в браузере Chrome?
 * - обратиться к переменной window.sbisPluginExtensionInfo, если она не равна undefined,
 * то необходимое расширение установлено и включено.
 * @return {void}
 */
function injectExtensionInfoToPage() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injectExtensionId.js');
    s.onload = function onload() {
        // @ts-ignore
        this.remove();
    };
    (document.head || document.documentElement).appendChild(s);
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
/**
 * Контентный скрипт расширения, дополненный специфичными для Chrome функциями
 * @author Есин А.И.
 */
const constatnts_1 = __webpack_require__(1322);
__webpack_require__(2830);
/*
Теперь в Chrome и Opera background.js внедряет в страницу content.js при запуске
(FF изначально сам так делает, причем сначала выгружая старый контентный скрипт)
Поэтому нужно стрельнуть из нового content.js в старый событием, чтобы тот уничтожил все подписки и был съеден GC.
 */
const destructionEvent = 'destructExtension_' + chrome.runtime.id;
document.dispatchEvent(new CustomEvent(destructionEvent));
document.addEventListener(destructionEvent, () => {
    chrome.runtime.onMessage.removeListener(receiveMessageFromBackground);
});
chrome.runtime.onMessage.addListener(receiveMessageFromBackground);
function receiveMessageFromBackground(message, sender, sendResponse) {
    // Принимаем сообщения только для широковещательного канала
    if (message.tab_id === constatnts_1.BROADCAST_TAB_ID) {
        message.type = 'FROM_CONTENT_SCRIPT_TO_WEB_PAGE';
        try {
            window.postMessage(message, '*');
        }
        catch (err) {
            // tslint:disable-next-line:no-console
            console.error('Send message to web page fail (' + err.name + ') : ' + err.message);
        }
    }
}

})();

/******/ })()
;