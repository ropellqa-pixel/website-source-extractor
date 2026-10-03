/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 2675:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SharedServiceConnection = exports.CONNECTION_NAME_REGEXP = void 0;
const constants_1 = __webpack_require__(2225);
const constatnts_1 = __webpack_require__(1322);
const throttle_1 = __webpack_require__(6104);
/**
 * Получить название приложения по идентификатору
 * @param {Number} [appId] идентификатор
 * @private
 */
function getAppNameById(appId) {
    if (!appId) {
        return;
    }
    switch (appId) {
        case constatnts_1.APP_ID.Admin:
            return constatnts_1.APP_NAME.Admin;
        case constatnts_1.APP_ID.Plugin:
            return constatnts_1.APP_NAME.Plugin;
        case constatnts_1.APP_ID.Screen:
            return constatnts_1.APP_NAME.Screen;
        case constatnts_1.APP_ID.Cam:
            return constatnts_1.APP_NAME.Cam;
    }
}
const SABY_COMMANDS_TO_OBSERVE = ['connect', 'message', 'error', 'disconnect'];
exports.CONNECTION_NAME_REGEXP = /ServiceConnection.(.+)/;
class SharedServiceConnection {
    constructor({ pageTransport, nmhPort, api }) {
        this._connectionsByApp = new Map();
        this._connectionLockByApp = {};
        this._lastConnectedEventByApp = {};
        this._throttledSendFunctions = {};
        this._pageTransport = pageTransport;
        this._nmhPort = nmhPort;
        this._api = api;
    }
    /**
     * Установить слушатель событий изменения статуса подключения к десктопным приложениям
     * @param listener Обработчик
     */
    setConnectionStateListener(listener) {
        this._onConnectionStateChange = listener;
    }
    /**
     * Проверить должны ли проходить сообщения из указанного порта через служебное соединение
     * @param portName Имя порта
     * @returns true если должны
     */
    isServicePort(portName) {
        return exports.CONNECTION_NAME_REGEXP.test(portName);
    }
    /**
     * Послать исходящее сообщение в служебное соединение
     * @param message Сообщение
     * @param portName Название порта
     */
    sendOutcomeMessage(message, portName) {
        var _a;
        const [, appName] = portName.match(exports.CONNECTION_NAME_REGEXP);
        const combinedId = `${message.id}:${message.tab_id}`;
        const tabId = constatnts_1.APP_ID[appName];
        // Команду connect троттлим, чтобы не заваливать транспорт коннектами с кучи вкладок
        if (message.cmd === 'connect' && message.data === 'nng') {
            if (!this._connectionsByApp.has(appName)) {
                this._connectionsByApp.set(appName, new Set());
            }
            if (!this._throttledSendFunctions[appName]) {
                this._throttledSendFunctions[appName] = (0, throttle_1.default)(this._nmhPort.sendMessageToNmh.bind(this._nmhPort), 5000, true);
            }
            (_a = this._connectionsByApp.get(appName)) === null || _a === void 0 ? void 0 : _a.add(combinedId);
            if (!this._connectionLockByApp[appName]) {
                this._connectionLockByApp[appName] = true;
                this._throttledSendFunctions[appName](Object.assign(Object.assign({}, message), { id: constatnts_1.APP_CONNECTION_ID, tab_id: tabId }));
            }
        }
        if (message.cmd === 'message') {
            this._nmhPort.sendMessageToNmh(Object.assign(Object.assign({}, message), { id: constatnts_1.APP_CONNECTION_ID, tab_id: tabId }));
        }
        if (message.cmd === 'disconnect') {
            this._connectionLockByApp[appName] = false;
            const connections = this._connectionsByApp.get(appName);
            const connectionsToDelete = [];
            connections === null || connections === void 0 ? void 0 : connections.forEach((combinedId) => {
                const [, tabId] = combinedId.split(':');
                if (parseInt(tabId, 10) === message.tab_id) {
                    connectionsToDelete.push(combinedId);
                }
            });
            connectionsToDelete.forEach((value) => connections === null || connections === void 0 ? void 0 : connections.delete(value));
        }
    }
    /**
     * Обработать входящее сообщение от десктопного приложения
     * @param message Сообщение
     * @returns true если сообщение было обработано
     */
    onIncomeMessage(message) {
        let result = false;
        if (message.id === constatnts_1.APP_CONNECTION_ID) {
            const appName = getAppNameById(message.tab_id);
            if (SABY_COMMANDS_TO_OBSERVE.indexOf(message.cmd) === -1) {
                return result;
            }
            result = true;
            let needRefreshState = false;
            let connState = constatnts_1.CONNECTION_STATE.UNKNOWN;
            if (message.cmd === 'connect') {
                if (appName) {
                    this._broadcastConnectResult(appName, message);
                    if (!message.data) {
                        // Если в connect нет данных, значит подключение уже существует
                        // connected не придет
                        this._broadcastConnectResult(appName, this._lastConnectedEventByApp[appName]);
                        this._connectionLockByApp[appName] = false;
                        needRefreshState = true;
                        connState = constatnts_1.CONNECTION_STATE.ALIVE;
                    }
                }
            }
            if (message.cmd === 'message') {
                const msgPayload = JSON.parse(message.data);
                if (msgPayload.type === 'event') {
                    if (msgPayload.data.eventName === 'connected' && appName) {
                        this._broadcastConnectResult(appName, message);
                        this._lastConnectedEventByApp[appName] = message;
                        this._connectionLockByApp[appName] = false;
                        needRefreshState = true;
                        connState = constatnts_1.CONNECTION_STATE.ALIVE;
                    }
                    this._processIncomeMessage(msgPayload);
                }
            }
            if (message.cmd === 'error') {
                if (appName) {
                    this._broadcastConnectResult(appName, message);
                    delete this._lastConnectedEventByApp[appName];
                    this._connectionLockByApp[appName] = false;
                    try {
                        const error = JSON.parse(message.data);
                        needRefreshState = error.flags === 0;
                    }
                    catch (_a) {
                        needRefreshState = true;
                    }
                    connState = constatnts_1.CONNECTION_STATE.DEAD;
                }
            }
            if (message.cmd === 'disconnect') {
                if (appName) {
                    this._broadcastConnectResult(appName, message);
                    delete this._lastConnectedEventByApp[appName];
                    this._connectionLockByApp[appName] = false;
                    connState = constatnts_1.CONNECTION_STATE.DEAD;
                }
            }
            if (needRefreshState) {
                this._refreshStateByApp(appName);
            }
            if (this._onConnectionStateChange && connState !== constatnts_1.CONNECTION_STATE.UNKNOWN) {
                this._onConnectionStateChange(message.tab_id, connState === constatnts_1.CONNECTION_STATE.ALIVE);
            }
        }
        return result;
    }
    /**
     * Разослать сообщение всем вкладкам, которые подключались к единому служебному соединению
     * @param appName Приложение
     * @param message Сообщение
     */
    _broadcastConnectResult(appName, message) {
        const connections = this._connectionsByApp.get(appName);
        connections === null || connections === void 0 ? void 0 : connections.forEach((combinedId) => {
            const [id, tabId] = combinedId.split(':');
            this._pageTransport.sendMessage(Object.assign(Object.assign({}, message), { id: parseInt(id, 10), tab_id: parseInt(tabId, 10) }));
        });
    }
    _processIncomeMessage(msgPayload) {
        return __awaiter(this, void 0, void 0, function* () {
            if (msgPayload.data.eventName === 'browser-extension.open-link') {
                const notice = msgPayload.data.data.Notice;
                const url = msgPayload.data.data.Url;
                const eventId = msgPayload.data.data.EventId;
                try {
                    const lastFocusedWindow = yield this._api.windows.getLastFocused();
                    if (!(lastFocusedWindow === null || lastFocusedWindow === void 0 ? void 0 : lastFocusedWindow.id)) {
                        /* Выходим если нет последнего окна. Такое может быть в MSEdge:
                         * расширение продолжает работать даже после закрытия браузера
                         */
                        return;
                    }
                    const activeTab = (yield this._api.tabs.query({ active: true, windowId: lastFocusedWindow.id }))[0];
                    if (activeTab && activeTab.url) {
                        const isTrustedTab = yield this._isURLTrusted(activeTab.url);
                        if (isTrustedTab) {
                            const command = {
                                type: constants_1.COMMAND_TYPE.OPEN_NOTICE,
                                data: {
                                    notice,
                                    eventId
                                }
                            };
                            const dataSent = this._pageTransport.sendToTab({
                                id: constatnts_1.BROADCAST_TAB_ID,
                                tab_id: activeTab.id,
                                cmd: 'extension_command',
                                data: JSON.stringify(command)
                            }, activeTab.id);
                            if (dataSent) {
                                this._api.windows.update(activeTab.windowId, { focused: true });
                                return;
                            }
                        }
                    }
                }
                catch (_a) {
                    //
                }
            }
        });
    }
    _isURLTrusted(url) {
        return new Promise((resolve) => {
            this._api.permissions.contains({
                origins: [url]
            }, resolve);
        });
    }
    /**
     * Сбросить стейт флагов в исполняемом файле
     * @param appName Идентификатор приложения
     */
    _refreshStateByApp(appName) {
        this._nmhPort.sendMessageToNmh({
            action: 'refreshState',
            appName,
            cmd: 'run_action',
            data: '',
            id: constatnts_1.APP_CONNECTION_ID,
            origin: 'https://api.sbis.ru',
            tab_id: constatnts_1.APP_ID[appName],
            type: 'FROM_BACKGROUND_SCRIPT_TO_NMH'
        });
    }
}
exports.SharedServiceConnection = SharedServiceConnection;


/***/ }),

/***/ 2225:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.NOTICE_ID = exports.EXTENSION_ACTION_CMD = exports.COMMAND_TYPE = exports.PLUGIN_ACTION = exports.ACTION = exports.APP_LIST = exports.APP_CHECK_TIMEOUT = exports.APP_CHECK_STATUS = exports.ACTION_STATUS = void 0;
/**
 * Статус обработки команды
 * @public
 */
var ACTION_STATUS;
(function (ACTION_STATUS) {
    ACTION_STATUS[ACTION_STATUS["SUCCESS"] = 0] = "SUCCESS";
    ACTION_STATUS[ACTION_STATUS["PROGRESS"] = 1] = "PROGRESS";
    ACTION_STATUS[ACTION_STATUS["FAIL"] = 2] = "FAIL";
})(ACTION_STATUS || (exports.ACTION_STATUS = ACTION_STATUS = {}));
/**
 * Статус последней проверки приложения
 * @public
 */
var APP_CHECK_STATUS;
(function (APP_CHECK_STATUS) {
    APP_CHECK_STATUS["SUCCESS"] = "success";
    APP_CHECK_STATUS["UNKNOWN"] = "unknown";
    APP_CHECK_STATUS["FAIL"] = "failure";
})(APP_CHECK_STATUS || (exports.APP_CHECK_STATUS = APP_CHECK_STATUS = {}));
/**
 * Таймаут пинга приложений. Равен 10 минутам
 */
exports.APP_CHECK_TIMEOUT = 600000;
/**
 * Список приложений
 */
var APP_LIST;
(function (APP_LIST) {
    APP_LIST["Plugin"] = "Plugin";
    APP_LIST["Admin"] = "Admin";
    APP_LIST["Cam"] = "Cam";
    APP_LIST["Screen"] = "Screen";
})(APP_LIST || (exports.APP_LIST = APP_LIST = {}));
/**
 * Список команд
 * @public
 */
var ACTION;
(function (ACTION) {
    // Запустить загруженный файл
    ACTION["RUN_DOWNLOADED_FILE"] = "RUN_DOWNLOADED_FILE";
    // Открыть проводник и подсветить загруженный файл
    ACTION["SHOW_DOWNLOADED_FILE"] = "SHOW_DOWNLOADED_FILE";
    // Поднять окно браузера
    ACTION["SET_FOREGROUND_WINDOW"] = "SET_FOREGROUND_WINDOW";
    // Вернуть фокус на текущую вкладку браузера
    ACTION["FOCUS_ON_TAB"] = "FOCUS_ON_TAB";
    // Открыть новую вкладку
    ACTION["OPEN_NEW_TAB"] = "OPEN_NEW_TAB";
    // Добавить закладку в браузере
    ACTION["ADD_BOOKMARK"] = "ADD_BOOKMARK";
    ACTION["GET_EXTENSION_SERVICE_ID"] = "SabyNoticeManager.GET_EXTENSION_SERVICE_ID";
})(ACTION || (exports.ACTION = ACTION = {}));
var PLUGIN_ACTION;
(function (PLUGIN_ACTION) {
    // Открыть уведомление
    PLUGIN_ACTION["OPEN_NOTICE"] = "OPEN_NOTICE";
})(PLUGIN_ACTION || (exports.PLUGIN_ACTION = PLUGIN_ACTION = {}));
var COMMAND_TYPE;
(function (COMMAND_TYPE) {
    // Открыть уведомление на активной вкладке
    COMMAND_TYPE["OPEN_NOTICE"] = "OPEN_NOTICE";
})(COMMAND_TYPE || (exports.COMMAND_TYPE = COMMAND_TYPE = {}));
exports.EXTENSION_ACTION_CMD = 'extension_action';
exports.NOTICE_ID = 'saby_plugin_notice';


/***/ }),

/***/ 6715:
/***/ (function(__unused_webpack_module, exports) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getApiObject = getApiObject;
exports.setApiObject = setApiObject;
exports.getDownloadItems = getDownloadItems;
exports.openNewTab = openNewTab;
exports.getGuid = getGuid;
let API;
/**
 * Получить объект API расширения (chrome в хроме и browser в FF)
 * @returns
 */
function getApiObject() {
    return API;
}
/**
 * Установить объект API расширения
 * @param api
 */
function setApiObject(api) {
    API = api;
}
/**
 * Получить массив загруженных файлов по переданному фильтру
 * @param query
 * @private
 */
function getDownloadItems(query) {
    return __awaiter(this, void 0, void 0, function* () {
        /* Нас интересуют только файлы, полученные с update.sbis.ru
        Учитываем зеркала вида update-msk1.sbis
        */
        query.urlRegex = 'https://.*update.*\.(sbis\.ru)|(setty\.kz)|(papirus\.tm)/.+';
        const items = yield API.downloads.search(query);
        return items;
    });
}
/**
 * Открыть новкую вкладку в указанном окне
 * @param url
 * @param windowId
 */
function openNewTab(url, windowId) {
    API.tabs.create({ url, windowId });
    API.windows.update(windowId, { focused: true });
}
function getGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        // eslint-disable-next-line no-bitwise
        const r = (Math.random() * 16) | 0;
        // eslint-disable-next-line no-bitwise
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}


/***/ }),

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

/***/ 6194:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Конвертация кириллических URL из punycode. Целиком заёмный файл, не приводим к стандартам, не линтуем.
 * @author Волков Д.А.
 */
// @ts-nocheck
/* tslint:disable */
Object.defineProperty(exports, "__esModule", ({ value: true }));
// http://stackoverflow.com/questions/183485/can-anyone-recommend-a-good-free-javascript-for-punycode-to-unicode-conversion
//Javascript Punycode converter derived from example in RFC3492.
//This implementation is created by some@domain.name and released into public domain
const punycode = (function Punycode() {
    // This object converts to and from puny-code used in IDN
    //
    // punycode.toASCII ( domain )
    //
    // Returns a puny coded representation of "domain".
    // It only converts the part of the domain name that
    // has non ASCII characters. I.e. it dosent matter if
    // you call it with a domain that already is in ASCII.
    //
    // punycode.toUnicode (domain)
    //
    // Converts a puny-coded domain name to unicode.
    // It only converts the puny-coded parts of the domain name.
    // I.e. it dosent matter if you call it on a string
    // that already has been converted to unicode.
    //
    //
    const context = {};
    context.utf16 = {
        // The utf16-class is necessary to convert from javascripts internal character representation to unicode and back.
        decode: function (input) {
            var output = [], i = 0, len = input.length, value, extra;
            while (i < len) {
                value = input.charCodeAt(i++);
                if ((value & 0xF800) === 0xD800) {
                    extra = input.charCodeAt(i++);
                    if (((value & 0xFC00) !== 0xD800) || ((extra & 0xFC00) !== 0xDC00)) {
                        throw new RangeError('UTF-16(decode): Illegal UTF-16 sequence');
                    }
                    value = ((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000;
                }
                output.push(value);
            }
            return output;
        },
        encode: function (input) {
            var output = [], i = 0, len = input.length, value;
            while (i < len) {
                value = input[i++];
                if ((value & 0xF800) === 0xD800) {
                    throw new RangeError('UTF-16(encode): Illegal UTF-16 value');
                }
                if (value > 0xFFFF) {
                    value -= 0x10000;
                    output.push(String.fromCharCode(((value >>> 10) & 0x3FF) | 0xD800));
                    value = 0xDC00 | (value & 0x3FF);
                }
                output.push(String.fromCharCode(value));
            }
            return output.join('');
        }
    };
    //Default parameters
    var initial_n = 0x80;
    var initial_bias = 72;
    var delimiter = '\x2D';
    var base = 36;
    var damp = 700;
    var tmin = 1;
    var tmax = 26;
    var skew = 38;
    var maxint = 0x7FFFFFFF;
    // decode_digit(cp) returns the numeric value of a basic code
    // point (for use in representing integers) in the range 0 to
    // base-1, or base if cp is does not represent a value.
    function decode_digit(cp) {
        return cp - 48 < 10 ? cp - 22 : cp - 65 < 26 ? cp - 65 : cp - 97 < 26 ? cp - 97 : base;
    }
    // encode_digit(d,flag) returns the basic code point whose value
    // (when used for representing integers) is d, which needs to be in
    // the range 0 to base-1. The lowercase form is used unless flag is
    // nonzero, in which case the uppercase form is used. The behavior
    // is undefined if flag is nonzero and digit d has no uppercase form.
    function encode_digit(d, flag) {
        return d + 22 + 75 * (d < 26) - ((flag != 0) << 5);
        //  0..25 map to ASCII a..z or A..Z
        // 26..35 map to ASCII 0..9
    }
    //** Bias adaptation function **
    function adapt(delta, numpoints, firsttime) {
        var k;
        delta = firsttime ? Math.floor(delta / damp) : (delta >> 1);
        delta += Math.floor(delta / numpoints);
        for (k = 0; delta > (((base - tmin) * tmax) >> 1); k += base) {
            delta = Math.floor(delta / (base - tmin));
        }
        return Math.floor(k + (base - tmin + 1) * delta / (delta + skew));
    }
    // encode_basic(bcp,flag) forces a basic code point to lowercase if flag is zero,
    // uppercase if flag is nonzero, and returns the resulting code point.
    // The code point is unchanged if it is caseless.
    // The behavior is undefined if bcp is not a basic code point.
    function encode_basic(bcp, flag) {
        bcp -= (bcp - 97 < 26) << 5;
        return bcp + ((!flag && (bcp - 65 < 26)) << 5);
    }
    // Main decode
    context.decode = function (input, preserveCase) {
        // Dont use utf16
        var output = [];
        var case_flags = [];
        var input_length = input.length;
        var n, out, i, bias, basic, j, ic, oldi, w, k, digit, t, len;
        // Initialize the state:
        n = initial_n;
        i = 0;
        bias = initial_bias;
        // Handle the basic code points: Let basic be the number of input code
        // points before the last delimiter, or 0 if there is none, then
        // copy the first basic code points to the output.
        basic = input.lastIndexOf(delimiter);
        if (basic < 0) {
            basic = 0;
        }
        for (j = 0; j < basic; ++j) {
            if (preserveCase) {
                case_flags[output.length] = (input.charCodeAt(j) - 65 < 26);
            }
            if (input.charCodeAt(j) >= 0x80) {
                throw new RangeError('Illegal input >= 0x80');
            }
            output.push(input.charCodeAt(j));
        }
        // Main decoding loop: Start just after the last delimiter if any
        // basic code points were copied; start at the beginning otherwise.
        for (ic = basic > 0 ? basic + 1 : 0; ic < input_length;) {
            // ic is the index of the next character to be consumed,
            // Decode a generalized variable-length integer into delta,
            // which gets added to i. The overflow checking is easier
            // if we increase i as we go, then subtract off its starting
            // value at the end to obtain delta.
            for (oldi = i, w = 1, k = base;; k += base) {
                if (ic >= input_length) {
                    throw RangeError('punycode_bad_input(1)');
                }
                digit = decode_digit(input.charCodeAt(ic++));
                if (digit >= base) {
                    throw RangeError('punycode_bad_input(2)');
                }
                if (digit > Math.floor((maxint - i) / w)) {
                    throw RangeError('punycode_overflow(1)');
                }
                i += digit * w;
                t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
                if (digit < t) {
                    break;
                }
                if (w > Math.floor(maxint / (base - t))) {
                    throw RangeError('punycode_overflow(2)');
                }
                w *= (base - t);
            }
            out = output.length + 1;
            bias = adapt(i - oldi, out, oldi === 0);
            // i was supposed to wrap around from out to 0,
            // incrementing n each time, so we'll fix that now:
            if (Math.floor(i / out) > maxint - n) {
                throw RangeError('punycode_overflow(3)');
            }
            n += Math.floor(i / out);
            i %= out;
            // Insert n at position i of the output:
            // Case of last character determines uppercase flag:
            if (preserveCase) {
                case_flags.splice(i, 0, input.charCodeAt(ic - 1) - 65 < 26);
            }
            output.splice(i, 0, n);
            i++;
        }
        if (preserveCase) {
            for (i = 0, len = output.length; i < len; i++) {
                if (case_flags[i]) {
                    output[i] = (String.fromCharCode(output[i]).toUpperCase()).charCodeAt(0);
                }
            }
        }
        return context.utf16.encode(output);
    };
    //** Main encode function **
    context.encode = function (input, preserveCase) {
        //** Bias adaptation function **
        var n, delta, h, b, bias, j, m, q, k, t, ijv, case_flags;
        if (preserveCase) {
            // Preserve case, step1 of 2: Get a list of the unaltered string
            case_flags = context.utf16.decode(input);
        }
        // Converts the input in UTF-16 to Unicode
        input = context.utf16.decode(input.toLowerCase());
        var input_length = input.length; // Cache the length
        if (preserveCase) {
            // Preserve case, step2 of 2: Modify the list to true/false
            for (j = 0; j < input_length; j++) {
                case_flags[j] = input[j] != case_flags[j];
            }
        }
        var output = [];
        // Initialize the state:
        n = initial_n;
        delta = 0;
        bias = initial_bias;
        // Handle the basic code points:
        for (j = 0; j < input_length; ++j) {
            if (input[j] < 0x80) {
                output.push(String.fromCharCode(case_flags ? encode_basic(input[j], case_flags[j]) : input[j]));
            }
        }
        h = b = output.length;
        // h is the number of code points that have been handled, b is the
        // number of basic code points
        if (b > 0) {
            output.push(delimiter);
        }
        // Main encoding loop:
        //
        while (h < input_length) {
            // All non-basic code points < n have been
            // handled already. Find the next larger one:
            for (m = maxint, j = 0; j < input_length; ++j) {
                ijv = input[j];
                if (ijv >= n && ijv < m) {
                    m = ijv;
                }
            }
            // Increase delta enough to advance the decoder's
            // <n,i> state to <m,0>, but guard against overflow:
            if (m - n > Math.floor((maxint - delta) / (h + 1))) {
                throw RangeError('punycode_overflow (1)');
            }
            delta += (m - n) * (h + 1);
            n = m;
            for (j = 0; j < input_length; ++j) {
                ijv = input[j];
                if (ijv < n) {
                    if (++delta > maxint) {
                        return Error('punycode_overflow(2)');
                    }
                }
                if (ijv == n) {
                    // Represent delta as a generalized variable-length integer:
                    for (q = delta, k = base;; k += base) {
                        t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
                        if (q < t) {
                            break;
                        }
                        output.push(String.fromCharCode(encode_digit(t + (q - t) % (base - t), 0)));
                        q = Math.floor((q - t) / (base - t));
                    }
                    output.push(String.fromCharCode(encode_digit(q, preserveCase && case_flags[j] ? 1 : 0)));
                    bias = adapt(delta, h + 1, h == b);
                    delta = 0;
                    ++h;
                }
            }
            ++delta, ++n;
        }
        return output.join('');
    };
    context.toASCII = function (domain) {
        var domain_array = domain.split('.');
        var out = [];
        for (var i = 0; i < domain_array.length; ++i) {
            var s = domain_array[i];
            out.push(s.match(/[^A-Za-z0-9-]/)
                ? 'xn--' + punycode.encode(s)
                : s);
        }
        return out.join('.');
    };
    context.toUnicode = function (domain) {
        var domain_array = domain.split('.');
        var out = [];
        for (var i = 0; i < domain_array.length; ++i) {
            var s = domain_array[i];
            out.push(s.match(/^xn--/)
                ? punycode.decode(s.slice(4))
                : s);
        }
        return out.join('.');
    };
    return context;
}());
exports["default"] = punycode;


/***/ }),

/***/ 7377:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const logger_1 = __webpack_require__(8601);
const constatnts_1 = __webpack_require__(1322);
const NATIVE_MESSAGING_HOST = 'ru.tensor.sbis_plugin_nmh';
const dummy = (msg) => {
    return;
};
/**
 * Класс для обмена данными с исполняемым файлом NMH
 * @author Есин А.И.
 */
class NmhPort {
    constructor() {
        /**
         * Состояние подключения NMH порта
         */
        this.connectionState = constatnts_1.CONNECTION_STATE.UNKNOWN;
        /**
         * Обработчик сообщения от NMH порта которое нужно разослать на все страницы
         */
        this.onBroadcast = dummy;
        this.queries = {};
        this._port = null;
        this._connectHandlers = [];
        this._messageHandlers = [];
        this._disconnectHandlers = [];
        this._receiveMessageFromNmh = this._receiveMessageFromNmh.bind(this);
    }
    /**
     * Подключение к NMH
     */
    connectToNmh(onSuccess) {
        if (this._port) {
            if (onSuccess) {
                onSuccess();
            }
            return;
        }
        // Открытие соединения с NMH
        try {
            this._port = chrome.runtime.connectNative(NATIVE_MESSAGING_HOST);
        }
        catch (err) {
            logger_1.default.error('Native Messaging Host connection fail (' + err.name + ') : ' + err.message);
            this._onDisconnect();
            return;
        }
        logger_1.default.log('Native Messaging Host connection successful');
        this.connectionState = constatnts_1.CONNECTION_STATE.ALIVE;
        if (onSuccess) {
            onSuccess();
        }
        // Установка обработчика "принято сообщение от NMH"
        this._port.onMessage.addListener(this._receiveMessageFromNmh);
        // Установка обработчика на событие "отключение NMH"
        this._port.onDisconnect.addListener(() => {
            var _a;
            this.connectionState = constatnts_1.CONNECTION_STATE.DEAD;
            logger_1.default.log('Native Messaging Host disconnected outside');
            // Уничтожить предыдущий NMH порт
            this._port = null;
            // Уведомить web страницы что все соединения были разорваны
            this.onBroadcast({
                id: constatnts_1.BROADCAST_TAB_ID,
                cmd: 'error',
                data: 'Native Messaging Host is crashed'
            });
            // NMH выключился - перезапустить
            if (((_a = chrome.runtime.lastError) === null || _a === void 0 ? void 0 : _a.message) === 'Native host has exited.') {
                this.connectToNmh();
            }
            this._onDisconnect();
        });
        this._onConnect();
    }
    /**
     * Отправка сообщения в NMH (nmh-transport в СБИС Плагин)
     * @param message
     */
    sendMessageToNmh(message) {
        if (!this._port) {
            this.connectToNmh();
            this._onMessage({
                tab_id: message.tab_id,
                id: message.id,
                cmd: 'error',
                data: 'Send message to NMH fail. NMHPort is unavailable'
            });
            return;
        }
        // Перезаписать направление передачи сообщения
        message.type = 'FROM_BACKGROUND_SCRIPT_TO_NMH';
        logger_1.default.debug('NmhPort:Send message', message);
        try {
            this._port.postMessage(message);
        }
        catch (err) {
            logger_1.default.error('Send message to NMH fail (' + err.name + ') : ' + err.message);
            this._onMessage({
                tab_id: message.tab_id,
                id: message.id,
                cmd: 'error',
                data: 'Send message to NMH fail'
            });
        }
    }
    /**
     * Отправка сообщения в NMH без предобработки
     * @param message
     */
    sendCleanMessageToNmh(message) {
        var _a;
        (_a = this._port) === null || _a === void 0 ? void 0 : _a.postMessage(message);
    }
    /**
     * Проверка наличия подключения к NMH
     */
    hasPort() {
        return !!this._port;
    }
    /**
     * Отключение от NMH
     */
    disconnectFromNmh() {
        if (!this._port) {
            return;
        }
        logger_1.default.log('Native Messaging Host disconnect');
        this._port.disconnect();
        this._port = null;
    }
    /**
     * Добавить обработчик установки связи с исполняемым файлом NMH
     * @param handler Обработчик
     */
    addConnectListener(handler) {
        this._connectHandlers.push(handler);
    }
    /**
     * Добавить обработчик входящего сообщения от NMH
     * @param handler Обработчик
     */
    addMessageListener(handler) {
        this._messageHandlers.push(handler);
    }
    /**
     * Добавить обработчик разрыва связи с исполняемым файлом NMH
     * @param handler Обработчик
     */
    addDisconnectListener(handler) {
        this._disconnectHandlers.push(handler);
    }
    /**
     * Приём сообщений от NMH (nmh-transport в СБИС Плагин)
     * @param messageObject Сообщение
     * @param sender Структура содержащая дескриптор отправителя сообщения
     */
    _receiveMessageFromNmh(messageObject, sender) {
        let message = messageObject;
        if (messageObject.payload) {
            message = JSON.parse(messageObject.payload);
        }
        logger_1.default.debug('NmhPort:Receive message', message);
        // Для случая когда объем возвращаемых данных превышает 1Mb
        // сообщения из СБИС Плагин разделяются на блоки не превышающие 1 Mb
        //
        // Для определения цепочки блоков одного сообщения из СБИС Плагин приходят данные содержащий следующие поля
        // parts_id - GUID единый для цепочки блоков одного сообщения
        // part - номер блока
        // parts - общее кол-во блоков в одной цепочке
        if (message.hasOwnProperty('parts') && parseInt(message.parts, 10) > 1) {
            if (!this.queries.hasOwnProperty(message.parts_id)) {
                this.queries[message.parts_id] = [];
                // Добавляем таймаут на ожидание всех блоков цепочки - ??? надо ли
            }
            const partsId = message.parts_id;
            // Сохраняем данные в буфере и ждем получения следующего блока цепочки
            this.queries[partsId].push(message);
            // Склеиваем блоки
            if (this.queries[partsId].length === parseInt(message.parts, 10)) {
                const result = {
                    cmd: message.cmd,
                    id: message.id,
                    tab_id: message.tab_id,
                    data: ''
                };
                this.queries[partsId].forEach((element) => {
                    result.data += element.data;
                });
                // Отправляем собранные блоки
                this._onMessage(result);
                // убираем из буфера
                delete this.queries[partsId];
            }
        }
        else {
            this._onMessage(message);
        }
    }
    /**
     * Запустить обработчики установки связи с исполняемым файлом NMH
     */
    _onConnect() {
        this._connectHandlers.forEach((handler) => handler());
    }
    /**
     * Запустить обработчики входящего сообщения от NMH
     * @param message Сообщение
     */
    _onMessage(message) {
        this._messageHandlers.forEach((handler) => handler(message));
    }
    /**
     * Запустить обработчики разрыва связи с исполняемым файлом NMH
     */
    _onDisconnect() {
        this._disconnectHandlers.forEach((handler) => handler());
    }
}
exports["default"] = NmhPort;


/***/ }),

/***/ 9633:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


/* tslint:disable:no-bitwise */
Object.defineProperty(exports, "__esModule", ({ value: true }));
const buildDeferred_1 = __webpack_require__(3549);
/**
 * Менеджер запросов к Saby Plugin
 * @public
 */
class QueryManager {
    constructor(sabyDesktopConnection) {
        this._queries = {};
        this._sabyDesktopConnection = sabyDesktopConnection;
    }
    parseMessage(message) {
        try {
            if (message.cmd === 'message') {
                const payload = JSON.parse(message.data);
                if (payload.queryId in this._queries) {
                    let result;
                    try {
                        const data = JSON.parse(payload.data);
                        result = data.result;
                    }
                    catch (_a) {
                        result = payload.data;
                    }
                    if (payload.type === 'error') {
                        this._queries[payload.queryId].reject(result);
                    }
                    else {
                        this._queries[payload.queryId].resolve(result);
                    }
                    return true;
                }
            }
            return false;
        }
        catch (_b) {
            return false;
        }
    }
    sendQuery(data) {
        const queryId = data.queryId;
        const deferred = (0, buildDeferred_1.default)();
        this._queries[queryId] = deferred;
        this._sabyDesktopConnection.sendData(JSON.stringify(data));
        return deferred.promise;
    }
}
exports["default"] = QueryManager;


/***/ }),

/***/ 3427:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const RECONNECT_TIMEOUT = 'RECONNECT_TIMEOUT';
class ReconnectTracker {
    constructor(nmhPort) {
        this._nmhPort = nmhPort;
        chrome.alarms.onAlarm.addListener(this._onAlarm.bind(this));
    }
    /**
     * Запустить таймаут реконнекта к NMH
     */
    createReconnectNmhTimeout() {
        chrome.alarms.create(RECONNECT_TIMEOUT, { delayInMinutes: 1 / 3 });
    }
    /**
     * Сбросить таймаут реконнекта к NMH
     */
    clearReconnectNmhTimeout() {
        chrome.alarms.clear(RECONNECT_TIMEOUT);
    }
    /**
     * Обработчик alarm'а
     */
    _onAlarm(alarm) {
        if (alarm.name === RECONNECT_TIMEOUT) {
            this._reconnect();
        }
    }
    /**
     * Переподключение к NMH
     */
    _reconnect() {
        this._nmhPort.disconnectFromNmh();
        this._nmhPort.connectToNmh();
        this.clearReconnectNmhTimeout();
    }
}
exports["default"] = ReconnectTracker;


/***/ }),

/***/ 3918:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const buildDeferred_1 = __webpack_require__(3549);
const constatnts_1 = __webpack_require__(1322);
const constants_1 = __webpack_require__(2225);
/**
 * Служебное соединение с плагином. Имеет уникальный origin
 * @public
 */
class SabyDesktopConnection {
    constructor(nmhPort) {
        this._nmhPort = nmhPort;
    }
    /**
     * Отправить данные в Saby Plugin
     * @param data
     */
    sendData(data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this._connectDeferred) {
                    this.reconnect();
                }
                yield this._connectDeferred.promise;
                this._nmhPort.sendMessageToNmh({
                    type: 'FROM_WEB_PAGE_TO_CONTENT_SCRIPT',
                    id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                    cmd: 'message',
                    data,
                    appName: constants_1.APP_LIST.Plugin,
                    tab_id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                    origin: 'https://api.sbis.ru'
                });
            }
            catch (_a) {
                // tslint:disable:no-console
                console.error(`Не могу отправить данные: ${data}`);
            }
        });
    }
    /**
     * Разобрать сообщение от Saby Plguin
     * @param message
     * @returns
     */
    parseMessage(message) {
        try {
            if (message.cmd === 'message') {
                const payload = JSON.parse(message.data);
                if (payload.type === 'event' && payload.data.eventName === 'connected') {
                    this._connectDeferred.resolve();
                    return true;
                }
            }
            if (message.cmd === 'error') {
                this._connectDeferred.reject();
                return true;
            }
            if (message.cmd === 'connect') {
                return true;
            }
            return false;
        }
        catch (_a) {
            return false;
        }
    }
    /**
     * Метод, который определяет, что сообщение должно быть обработано этим классом
     * @param message
     * @returns
     */
    isOwnMessage(message) {
        return message.tab_id === constatnts_1.SABY_DESKTOP_CONNECTION_ID;
    }
    /**
     * Переподключиться к Saby Plugin
     */
    reconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._connectDeferred) {
                // Дожидаемся ответа на предыдущий коннект
                try {
                    yield this._connectDeferred.promise;
                    // Отключаемся перед тем как подключиться снова
                    this._nmhPort.sendMessageToNmh({
                        cmd: 'disconnect',
                        appName: constants_1.APP_LIST.Plugin,
                        data: '',
                        id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                        origin: 'https://api.sbis.ru',
                        tab_id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                        type: 'FROM_CONTENT_SCRIPT_TO_BACKGROUND'
                    });
                }
                catch (_a) {
                    //
                }
            }
            this._connectDeferred = (0, buildDeferred_1.default)();
            this._connectDeferred.promise.catch(() => {
                return;
            });
            this._nmhPort.connectToNmh(() => {
                this._nmhPort.sendMessageToNmh({
                    cmd: 'connect',
                    data: 'nng',
                    appName: constants_1.APP_LIST.Plugin,
                    id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                    origin: 'https://api.sbis.ru',
                    tab_id: constatnts_1.SABY_DESKTOP_CONNECTION_ID,
                    type: 'FROM_CONTENT_SCRIPT_TO_BACKGROUND'
                });
            });
        });
    }
}
exports["default"] = SabyDesktopConnection;


/***/ }),

/***/ 1949:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Локализация строк для интефрейсных, компонентов расширения
 * @author Есин А.И.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getLocalizedString = exports.STRING_LOCALIZATION_KEY = exports.UI_LANG = void 0;
var UI_LANG;
(function (UI_LANG) {
    UI_LANG["EN"] = "en";
    UI_LANG["RU"] = "ru";
    UI_LANG["TK"] = "tk";
    UI_LANG["KK"] = "kk";
})(UI_LANG || (exports.UI_LANG = UI_LANG = {}));
var STRING_LOCALIZATION_KEY;
(function (STRING_LOCALIZATION_KEY) {
    STRING_LOCALIZATION_KEY[STRING_LOCALIZATION_KEY["INSTALL_BTN_ASK"] = 0] = "INSTALL_BTN_ASK";
    STRING_LOCALIZATION_KEY[STRING_LOCALIZATION_KEY["INSTALL_BTN_TITLE"] = 1] = "INSTALL_BTN_TITLE";
    STRING_LOCALIZATION_KEY[STRING_LOCALIZATION_KEY["RUN_FILE_ASK"] = 2] = "RUN_FILE_ASK";
    STRING_LOCALIZATION_KEY[STRING_LOCALIZATION_KEY["RUN_BTN_TITLE"] = 3] = "RUN_BTN_TITLE";
})(STRING_LOCALIZATION_KEY || (exports.STRING_LOCALIZATION_KEY = STRING_LOCALIZATION_KEY = {}));
const STRINGS_EN = {
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_ASK]: 'Please click on the notification to run the downloaded file $filename$',
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_TITLE]: 'Install',
    [STRING_LOCALIZATION_KEY.RUN_BTN_TITLE]: 'Run',
    [STRING_LOCALIZATION_KEY.RUN_FILE_ASK]: 'Please run the file $filename$ in the window that appears'
};
const STRINGS_KK = {
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_ASK]: 'Жүктелген $filename$ файлын іске қосу үшін хабарландыруды басыңыз',
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_TITLE]: 'Орнату',
    [STRING_LOCALIZATION_KEY.RUN_BTN_TITLE]: 'Іске қосу',
    [STRING_LOCALIZATION_KEY.RUN_FILE_ASK]: 'Пайда болған терезеде $filename$ файлын іске қосыңыз'
};
const STRINGS_TK = {
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_ASK]: 'Göçürilen faýly $filename$ işletmek üçin habarnama basyň',
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_TITLE]: 'Gurnama',
    [STRING_LOCALIZATION_KEY.RUN_BTN_TITLE]: 'Işletmek',
    [STRING_LOCALIZATION_KEY.RUN_FILE_ASK]: 'Görkezilýän penjirede $filename$ faýly işlediň.'
};
const STRINGS_RU = {
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_ASK]: 'Пожалуйста, нажмите на уведомление, чтобы запустить скачанный файл $filename$',
    [STRING_LOCALIZATION_KEY.INSTALL_BTN_TITLE]: 'Установить',
    [STRING_LOCALIZATION_KEY.RUN_BTN_TITLE]: 'Запустить',
    [STRING_LOCALIZATION_KEY.RUN_FILE_ASK]: 'Пожалуйста, запустите файл $filename$ в появившемся окне'
};
const getLocalizedString = (stringKey, lang) => {
    switch (lang) {
        case UI_LANG.EN:
            return STRINGS_EN[stringKey];
        case UI_LANG.KK:
            return STRINGS_KK[stringKey];
        case UI_LANG.TK:
            return STRINGS_TK[stringKey];
        default:
            return STRINGS_RU[stringKey];
    }
};
exports.getLocalizedString = getLocalizedString;


/***/ }),

/***/ 3549:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = buildDeferred;
function buildDeferred() {
    let resolveFn;
    let rejectFn;
    const promise = new Promise((rslv, reject) => {
        resolveFn = rslv;
        rejectFn = reject;
    });
    return {
        resolve: resolveFn,
        reject: rejectFn,
        promise
    };
}


/***/ }),

/***/ 8601:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Логгер
 * @author Волков Д.А.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LOG_LEVEL = void 0;
/* eslint-disable @typescript-eslint/ban-tslint-comment */
// tslint:disable:no-console
// Префикс, выводимый в консоль перед записью логов
const LOG_PREFIX = 'SYTools:';
/**
 * Форматировать дату в читабельный вариант
 * @param {Date | number} [date] дата
 * @returns {string} дата с маской YYYY-MM-DD HH:mm:ss:SSS
 */
const formatLogDate = (baseDate = new Date()) => {
    const date = typeof baseDate === 'number' ? new Date(baseDate) : baseDate;
    const year = date.getFullYear();
    const month = `${date.getMonth()}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    const seconds = `${date.getSeconds()}`.padStart(2, '0');
    const milliseconds = `${date.getMilliseconds()}`.padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}:${milliseconds}`;
};
var LOG_LEVEL;
(function (LOG_LEVEL) {
    LOG_LEVEL[LOG_LEVEL["INFO"] = 0] = "INFO";
    LOG_LEVEL[LOG_LEVEL["DEBUG"] = 1] = "DEBUG";
})(LOG_LEVEL || (exports.LOG_LEVEL = LOG_LEVEL = {}));
/**
 * Логгер. Вывод логов в консоль в зависимости от признака debugMode, хранение в local storage.
 * Если debugMode == true, то логи выводятся
 */
class Logger {
    constructor() {
        this.logLevel = LOG_LEVEL.INFO;
    }
    /**
     * Показать сообщение в консоли
     * @param {Object} data Данные для вывода
     * @returns {void}
     */
    log(...messages) {
        if (this.logLevel >= LOG_LEVEL.INFO) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // tslint:disable-next-line:no-console
            console.log(LOG_PREFIX + formatLogDate(), ...messages);
        }
    }
    debug(...messages) {
        if (this.logLevel >= LOG_LEVEL.DEBUG) {
            // tslint:disable-next-line:no-console
            console.log(LOG_PREFIX + formatLogDate(), ...messages);
        }
    }
    /**
     * Показать ошибку в консоли
     * @param {Object} data Данные для вывода
     * @returns {void}
     */
    error(...messages) {
        if (this.logLevel >= LOG_LEVEL.INFO) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // tslint:disable-next-line:no-console
            console.error(LOG_PREFIX + formatLogDate(), ...messages);
        }
    }
    /**
     * Показать info в консоли
     * @param {Object} data Данные для вывода
     * @returns {void}
     */
    info(...messages) {
        if (this.logLevel >= LOG_LEVEL.INFO) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // tslint:disable-next-line:no-console
            console.info(LOG_PREFIX + formatLogDate(), ...messages);
        }
    }
}
const logger = new Logger();
// @ts-ignore
const global = typeof window === 'undefined' ? self : window;
// @ts-ignore
global.SPDebug = (level) => {
    if (typeof level === 'number') {
        logger.logLevel = level;
    }
    else {
        logger.logLevel = level ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO;
    }
};
exports["default"] = logger;


/***/ }),

/***/ 6104:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = throttle;
function throttle(original, delay, last) {
    let state = true;
    let next;
    return function (...args) {
        if (state) {
            // @ts-ignore
            original.apply(this, args);
            state = false;
            setTimeout(() => {
                state = true;
                if (last && next) {
                    next();
                    next = null;
                }
            }, delay);
        }
        else if (last) {
            // @ts-ignore
            next = original.bind(this, ...args);
        }
    };
}


/***/ }),

/***/ 6816:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = default_1;
/**
 * Функция выполнения браузерных особенностей chrome
 * @author Есин А.И.
 */
function reloadContentScripts() {
    const manifest = chrome.runtime.getManifest();
    const scripts = (manifest === null || manifest === void 0 ? void 0 : manifest.content_scripts) && manifest.content_scripts[0].js;
    const matches = (manifest === null || manifest === void 0 ? void 0 : manifest.content_scripts) && (manifest === null || manifest === void 0 ? void 0 : manifest.content_scripts[0].matches);
    chrome.tabs.query({ url: matches }, (foundTabs) => {
        foundTabs.forEach((tab) => {
            chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: scripts
            });
        });
    });
}
function closeStoreWindows() {
    chrome.tabs.query({
        url: [
            '*://chromewebstore.google.com/*/' + chrome.runtime.id + '*',
            '*://addons.opera.com/*/sbis-plugin-extension*'
        ]
    }, (foundTabs) => {
        foundTabs.forEach((tab) => {
            chrome.windows.get(tab.windowId, { populate: true }, (window) => {
                var _a;
                if (((_a = window === null || window === void 0 ? void 0 : window.tabs) === null || _a === void 0 ? void 0 : _a.length) === 1) {
                    chrome.windows.remove(tab.windowId);
                }
            });
        });
    });
}
function default_1() {
    // Обновляем content скрипты на страницах
    reloadContentScripts();
    // При включении закрываем окна с вкладкой расширения
    closeStoreWindows();
}


/***/ }),

/***/ 2284:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ServiceFactory = void 0;
const utils_1 = __webpack_require__(6715);
/**
 * Базовый класс образа расширения в Saby Plugin
 * @public
 */
class CommonService {
    constructor(serviceQueryManager) {
        this._guid = '';
        this._serviceQueryManager = serviceQueryManager;
        this.reload();
    }
    /**
     * Позвать метод
     * @param query
     */
    callMethod(query) {
        return this._serviceQueryManager.sendQuery(Object.assign({ serviceGuid: this._guid, protoVersion: 1, queryId: (0, utils_1.getGuid)(), moduleVersion: '0' }, query));
    }
    /**
     * Перезагрузить расширение. Будет присвоен новый serviceID
     * @public
     */
    reload() {
        this._guid = (0, utils_1.getGuid)();
    }
}
class ServiceFactory {
    constructor(serviceQueryManager) {
        this._serviceQueryManager = serviceQueryManager;
    }
    getService() {
        return new CommonService(this._serviceQueryManager);
    }
}
exports.ServiceFactory = ServiceFactory;


/***/ }),

/***/ 4608:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
class TabManager {
    constructor(api) {
        this._api = api;
    }
    isURLTrusted(url) {
        return new Promise((resolve) => {
            this._api.permissions.contains({
                origins: [url]
            }, resolve);
        });
    }
    /**
     * Открыть новкую вкладку в указанном окне
     * @param url
     * @param windowId
     */
    openNewTab(url, windowId) {
        this._api.tabs.create({ url, windowId });
        this._api.windows.update(windowId, { focused: true });
    }
}
exports["default"] = TabManager;


/***/ }),

/***/ 2919:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Набор константы для расширений
 * @author Клименко И.А.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.APP_NAME = exports.ACTION_STATUS = exports.CONNECTION_STATE = exports.APP_ID = exports.APP_CONNECTION_ID = exports.SERVICE_CONNECTION_ID = exports.EXTENSION_LOADED_ID = exports.TRACKING_ID = exports.BROADCAST_TAB_ID = exports.ACTION_RESULT_CMD = exports.EXTENSION_ACTION_CMD = void 0;
// /** Виды транспорта */
// export enum TRANSPORT {
//     /** Долгоживущее соединение */
//     LONG_LIVED = 'LongLivedTransport',
//     /** Одиночные запросы */
//     SHORT_LIVED = 'ShortLivedTransport'
// };
// /** Модули расширения */
// export enum MODULES {
//     /** Модуль ининциализации расширения */
//     COORDINATOR = 'Coordinator',
//     /** Модуль слежения соединения с приложением */
//     APP_OBSERVER = 'AppObserver',
//     /** Модуль управления вкладками и окнами браузера */
//     WINDOW_MANAGER = 'WindowManager',
//     /** Модуль для работы со скачанными файлами */
//     APP_INSTALAATION_HELPER = 'AppInstallationHelper',
//     /** Модуль взаимодействия с закладками браузера */
//     BOOKMARKS = 'Bookmarks',
//     /** Модуль отслеживания активности */
//     ACTIVITY = 'Activity',
//     /** Модуль записи логов со страницы */
//     TS_HELPER = 'TSHelper',
// }
exports.EXTENSION_ACTION_CMD = 'extension_action';
exports.ACTION_RESULT_CMD = 'extension_action_result';
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
exports.SERVICE_CONNECTION_ID = -40;
/**
 * Условный идентификатор порта для служебного соединения c приложением
 */
exports.APP_CONNECTION_ID = -41;
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
 * Статус обработки команды
 * @public
 */
var ACTION_STATUS;
(function (ACTION_STATUS) {
    ACTION_STATUS[ACTION_STATUS["SUCCESS"] = 0] = "SUCCESS";
    ACTION_STATUS[ACTION_STATUS["PROGRESS"] = 1] = "PROGRESS";
    ACTION_STATUS[ACTION_STATUS["FAIL"] = 2] = "FAIL";
    ACTION_STATUS[ACTION_STATUS["UNKNOWN_ACTION"] = 3] = "UNKNOWN_ACTION";
})(ACTION_STATUS || (exports.ACTION_STATUS = ACTION_STATUS = {}));
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

/***/ 5222:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.UrlRecord = void 0;
const constants_1 = __webpack_require__(2919);
const constants_2 = __webpack_require__(9096);
/**
 * Запись о посещённом URL
 * @property {int} type 1 - URL, 0 - файл или devtools
 * @property {string} site адрес сайта
 * @property {int} timeFrom время перехода по ссылке
 * @property {int} timeTo время перехода по следующей ссылке
 */
class UrlRecord {
    /**
     * @constructor
     * @param {int} type 1 - сайт, 0 - файл или devtools
     * @param {string} site адрес сайта
     * @param {int} timeFrom  время перехода по ссылке
     * @param {int} timeTo время перехода по следующей ссылке
     */
    constructor(type, site, timeFrom = 0, timeTo = 0) {
        this.type = type;
        this.site = site;
        this.timeFrom = timeFrom;
        this.timeTo = timeTo;
    }
}
exports.UrlRecord = UrlRecord;
class ActivityAbstract {
    constructor(utils) {
        this.name = 'Activity';
        this.urlCache = [];
        this.urlToSend = [];
        this.connId = constants_2.AM_CONNECTION_ID_INITIAL;
        this.port = constants_2.AM_PORT_DEFAULT;
        this.needConnect = true;
        this.sendIntervalId = null;
        this._isConnectionAlive = false;
        this._amService = utils.serviceFactory.getService();
        this._utils = utils;
        this._onTabUpdated = this._onTabUpdated.bind(this);
        this._onTabActivated = this._onTabActivated.bind(this);
        this._onWindowFocusChanged = this._onWindowFocusChanged.bind(this);
        this._isEnabled().then((enabled) => enabled && this.start());
        this._utils.serviceConnection.setConnectionStateListener((appId, state) => {
            if (appId === constants_1.APP_ID.Plugin) {
                this._setConnectionStatus(state);
            }
        });
        this._utils.api.runtime.onMessage.addListener(({ action }) => {
            if (action === 'START_ACTIVITY') {
                this.start();
            }
            else if (action === 'STOP_ACTIVITY') {
                this.stop();
            }
        });
    }
    execute() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
            };
        });
    }
    _setConnectionStatus(isAlive) {
        const stateChanged = this._isConnectionAlive !== isAlive;
        this._isConnectionAlive = isAlive;
        if (!isAlive && stateChanged) {
            this.connId--; // новый id подключения. Отрицательный id, поэтому уменьшаем.
        }
    }
    /**
     * Зарегистрировать слушатели событий перехода по URL
     */
    start() {
        this._utils.logger.log('Запуск ActivityMonitor');
        chrome.tabs.onUpdated.addListener(this._onTabUpdated);
        chrome.tabs.onActivated.addListener(this._onTabActivated);
        // @ts-ignore
        chrome.windows.onFocusChanged.Filters = ['normal', 'devtools'];
        chrome.windows.onFocusChanged.addListener(this._onWindowFocusChanged);
        // @ts-ignore
        this.sendIntervalId = setInterval(() => this._sendUrls(), constants_2.AM_SEND_INTERVAL_MS);
    }
    /**
     * Удалить слушатели событий перехода по URL
     */
    stop() {
        this._utils.logger.log('Остановка ActivityMonitor');
        chrome.tabs.onUpdated.removeListener(this._onTabUpdated);
        chrome.tabs.onActivated.removeListener(this._onTabActivated);
        chrome.windows.onFocusChanged.removeListener(this._onWindowFocusChanged);
        if (this.sendIntervalId) {
            clearInterval(this.sendIntervalId);
        }
    }
    /**
     * Обработка события перехода по URL
     * @param url {String}
     */
    _onURLChanged(url) {
        const now = Math.floor(Date.now() / 1000); // округляем до целых секунд
        const cur = this._siteFromUrl(url);
        if (this.urlCache.length) {
            const prev = this.urlCache[this.urlCache.length - 1];
            prev.timeTo = now;
            if (prev.site === cur.site) {
                return;
            }
        }
        cur.timeFrom = now;
        this.urlCache.push(cur);
        this._utils.logger.info(cur.site);
    }
    _urlsToRecordSetTimestamp() {
        return {
            s: [
                { n: 'Type', t: 'Число целое' },
                { n: 'Name', t: 'Строка' },
                { n: 'Description', t: 'Строка' },
                { n: 'Begin', t: 'Число целое' },
                { n: 'End', t: 'Число целое' }
            ],
            f: 0,
            d: this.urlToSend.map((rec) => [rec.type, rec.site, '', rec.timeFrom, rec.timeTo]),
            _type: 'recordset'
        };
    }
    _onTabActivated(onActivated) {
        if (onActivated.tabId !== chrome.tabs.TAB_ID_NONE) {
            chrome.tabs.get(onActivated.tabId, (tab) => {
                this._onURLChanged(tab.url);
            });
        }
    }
    /**
     * Отправка в Плагин накопленной информации по URL
     * @returns {Promise<void>}
     */
    _sendUrls() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this.urlCache.length) {
                const now = Math.floor(Date.now() / 1000);
                const lastRec = this.urlCache[this.urlCache.length - 1];
                lastRec.timeTo = now;
                this.urlToSend = this.urlToSend.concat(this.urlCache.filter((rec) => {
                    return rec.timeFrom < rec.timeTo;
                }));
                this.urlCache = [new UrlRecord(lastRec.type, lastRec.site, now, now)];
            }
            if (this._isConnectionAlive && this.urlToSend.length > 0) {
                this._utils.logger.log(`Отправка ${this.urlToSend.length} записей`);
                (_a = this._amService) === null || _a === void 0 ? void 0 : _a.callMethod({
                    moduleName: 'ActivityMonitor',
                    query: JSON.stringify({
                        jsonrpc: '2.0',
                        protocol: 5,
                        method: 'ActivityMonitor.UrlFromExtension',
                        params: {
                            browser: this.browserName,
                            urls: this._urlsToRecordSetTimestamp(),
                            user_agent: navigator.userAgent
                        },
                        id: this.connId
                    })
                }).then((result) => {
                    if (result === null) {
                        this._utils.logger.log('успешная отправка');
                        this.urlToSend = [];
                    }
                }).catch((errInfo) => {
                    if (errInfo.errorType === 'RPC_ERROR') {
                        const error1 = errInfo.error;
                        this._utils.logger.log('RPC_ERROR ' + JSON.stringify(error1));
                    }
                });
            }
        });
    }
    _onTabUpdated(tabId, changeInfo, tab) {
        if (changeInfo.status === 'loading' && tab.active) {
            this._onURLChanged(tab.url);
        }
    }
}
exports["default"] = ActivityAbstract;


/***/ }),

/***/ 5603:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
/**
 * Модуль для обработки событий перехода по URL и отправки данных в Saby Desktop. Имплементация под Chrome
 * @author Есин А.И.
 */
const punycode_1 = __webpack_require__(6194);
const ActivityAbstract_1 = __webpack_require__(5222);
const constants_1 = __webpack_require__(9096);
function save(filename, data) {
    chrome.downloads.download({
        filename,
        saveAs: true,
        url: `data:text/plain,${data}`
    });
}
class ActivityChrome extends ActivityAbstract_1.default {
    constructor() {
        super(...arguments);
        this.browserName = 'chrome';
    }
    _isEnabled() {
        return new Promise((resolve) => {
            chrome.runtime.getPlatformInfo((info) => {
                if (info.os.search('linux') > -1) {
                    chrome.storage.local.get(constants_1.STORAGE_KEY).then((storage) => {
                        var _a;
                        resolve((_a = storage[constants_1.STORAGE_KEY]) !== null && _a !== void 0 ? _a : false);
                    });
                }
                else {
                    resolve(false);
                }
            });
        });
    }
    _onWindowFocusChanged(windowId) {
        if (windowId === chrome.windows.WINDOW_ID_NONE) {
            const queryOptions = {
                populate: false,
                windowTypes: ['normal', 'devtools']
            };
            chrome.windows.getCurrent(queryOptions, (window) => {
                if (window.type === 'devtools') {
                    this._onURLChanged('devtools');
                }
            });
        }
        else {
            chrome.tabs.query({ active: true, windowId }, (tabs) => {
                var _a;
                this._onURLChanged((_a = tabs[0]) === null || _a === void 0 ? void 0 : _a.url);
            });
        }
    }
    _siteFromUrl(url) {
        if (!url || url === 'devtools') {
            return new ActivityAbstract_1.UrlRecord(0, 'Инструмент разработчика в браузере');
        }
        const urlObj = new URL(url);
        if (urlObj.protocol === 'file:') {
            return new ActivityAbstract_1.UrlRecord(0, 'Просмотр файлов в браузере');
        }
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
            return new ActivityAbstract_1.UrlRecord(0, this.browserName);
        }
        return new ActivityAbstract_1.UrlRecord(1, punycode_1.default.toUnicode(urlObj.hostname));
    }
}
exports["default"] = ActivityChrome;


/***/ }),

/***/ 9096:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.STORAGE_KEY = exports.AM_SAVE_LOGS_URL = exports.AM_SEND_INTERVAL_MS = exports.AM_PORT_DEFAULT = exports.AM_CONNECTION_ID_INITIAL = void 0;
/**
 * Начальный идентификатор собщений ActivityMonitor
 * Должен иметь наменьшее значение, т.к. может динамически уменьшаться
 */
exports.AM_CONNECTION_ID_INITIAL = -120;
exports.AM_PORT_DEFAULT = 8201;
/**
 * Интервал отправки данных в Плагин
 * @type {number}
 */
exports.AM_SEND_INTERVAL_MS = 5 * 60 * 1000;
/**
 * URL, при переходе по которому предлагается сохранить файл с логами расширения
 * @type {string}
 */
exports.AM_SAVE_LOGS_URL = 'chrome://extensions/SYTools/save_logs';
/** Ключ настройки в хранилище */
exports.STORAGE_KEY = 'ACTIVITY';


/***/ }),

/***/ 494:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ACTION = exports.NOTICE_ID = void 0;
const UILocalization_1 = __webpack_require__(1949);
const constants_1 = __webpack_require__(2919);
exports.NOTICE_ID = 'saby_plugin_notice';
/**
 * Список команд
 * @public
 */
var ACTION;
(function (ACTION) {
    // Запустить загруженный файл
    ACTION["RUN_DOWNLOADED_FILE"] = "RUN_DOWNLOADED_FILE";
    // Открыть проводник и подсветить загруженный файл
    ACTION["SHOW_DOWNLOADED_FILE"] = "SHOW_DOWNLOADED_FILE";
})(ACTION || (exports.ACTION = ACTION = {}));
let lastNoticeHandler;
class AppInstallationHelper {
    constructor(utils) {
        this.name = 'AppInstallationHelper';
        this._utils = utils;
    }
    execute(action, payload) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (action) {
                case ACTION.RUN_DOWNLOADED_FILE:
                    return this._runDownloadedFile(payload);
                case ACTION.SHOW_DOWNLOADED_FILE:
                    return this._showDownloadedFile(payload);
                default:
                    return {
                        status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
                    };
            }
        });
    }
    _runDownloadedFile(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiObject = this._utils.api;
            const lang = (payload === null || payload === void 0 ? void 0 : payload.lang) || UILocalization_1.UI_LANG.RU;
            const downloadItems = yield this._getDownloadItems({
                filenameRegex: payload.filename,
                orderBy: ['-startTime'],
                exists: true,
                state: 'complete',
                startedAfter: payload.timeStamp
            });
            if (downloadItems.length > 0) {
                const lastItem = downloadItems.shift();
                // @ts-ignore
                const downloadId = lastItem.id;
                // @ts-ignore
                const foundFilename = lastItem.filename.replace(/\\/g, '/').split('/').pop();
                const message = (0, UILocalization_1.getLocalizedString)(UILocalization_1.STRING_LOCALIZATION_KEY.INSTALL_BTN_ASK, lang).replace('$filename$', foundFilename);
                const buttons = [
                    {
                        title: (0, UILocalization_1.getLocalizedString)(payload.actionType === 'install'
                            ? UILocalization_1.STRING_LOCALIZATION_KEY.INSTALL_BTN_TITLE
                            : UILocalization_1.STRING_LOCALIZATION_KEY.RUN_BTN_TITLE, lang)
                    }
                ];
                const nOptions = Object.assign(Object.assign({}, this._buildNoticeConfig()), { message,
                    buttons, requireInteraction: true });
                return new Promise((resolve) => {
                    const onNoticeClick = (noticeId) => {
                        if (noticeId === exports.NOTICE_ID) {
                            apiObject.downloads.open(downloadId);
                            apiObject.notifications.onClicked.removeListener(onNoticeClick);
                            apiObject.notifications.onButtonClicked.removeListener(onNoticeClick);
                            lastNoticeHandler = null;
                            resolve({
                                status: constants_1.ACTION_STATUS.SUCCESS,
                                data: {
                                    filename: foundFilename,
                                    downloadId
                                }
                            });
                            apiObject.notifications.clear(exports.NOTICE_ID);
                        }
                    };
                    if (lastNoticeHandler) {
                        apiObject.notifications.onClicked.removeListener(lastNoticeHandler);
                        apiObject.notifications.onButtonClicked.removeListener(lastNoticeHandler);
                    }
                    apiObject.notifications.clear(exports.NOTICE_ID, () => {
                        apiObject.notifications.create(exports.NOTICE_ID, nOptions, () => {
                            apiObject.notifications.onClicked.addListener(onNoticeClick);
                            chrome.notifications.onButtonClicked.addListener(onNoticeClick);
                            lastNoticeHandler = onNoticeClick;
                            resolve({
                                status: constants_1.ACTION_STATUS.PROGRESS,
                                data: {
                                    filename: foundFilename,
                                    downloadId
                                }
                            });
                        });
                    });
                });
            }
            else {
                return { status: constants_1.ACTION_STATUS.FAIL };
            }
        });
    }
    _showDownloadedFile(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiObject = this._utils.api;
            const lang = (payload === null || payload === void 0 ? void 0 : payload.lang) || UILocalization_1.UI_LANG.RU;
            if (payload.downloadId) {
                apiObject.downloads.show(payload.downloadId);
                return {
                    status: constants_1.ACTION_STATUS.SUCCESS
                };
            }
            const downloadItems = yield this._getDownloadItems({
                filenameRegex: payload.filename,
                orderBy: ['-startTime'],
                exists: true,
                startedAfter: payload.timeStamp
            });
            if (downloadItems.length > 0) {
                const lastItem = downloadItems.shift();
                // @ts-ignore
                const downloadId = lastItem.id;
                // @ts-ignore
                const foundFilename = lastItem.filename.replace(/\\/g, '/').split('/').pop();
                const message = (0, UILocalization_1.getLocalizedString)(UILocalization_1.STRING_LOCALIZATION_KEY.RUN_FILE_ASK, lang).replace('$filename$', foundFilename);
                const nOptions = Object.assign(Object.assign({}, this._buildNoticeConfig()), { message });
                apiObject.notifications.clear(exports.NOTICE_ID, () => {
                    apiObject.notifications.create(exports.NOTICE_ID, nOptions, () => {
                        apiObject.downloads.show(downloadId);
                    });
                });
                return {
                    status: constants_1.ACTION_STATUS.SUCCESS,
                    data: {
                        filename: foundFilename,
                        downloadId
                    }
                };
            }
            return { status: constants_1.ACTION_STATUS.FAIL };
        });
    }
    /**
     * Получить массив загруженных файлов по переданному фильтру
     * @param query
     * @private
     */
    _getDownloadItems(query) {
        return __awaiter(this, void 0, void 0, function* () {
            // Нас интересуют только файлы, полученные с update.sbis.ru
            // Учитываем зеркала вида update-msk1.sbis
            query.urlRegex = 'https://.*update.*\.(sbis\.ru)|(setty\.kz)|(papirus\.tm)/.+';
            const items = yield this._utils.api.downloads.search(query);
            return items;
        });
    }
    _buildNoticeConfig() {
        const iconUrl = this._utils.api.runtime.getURL('logo_48.png');
        const title = 'SYTools';
        return {
            type: 'basic',
            iconUrl,
            priority: 2,
            title,
            message: ''
        };
    }
}
exports["default"] = AppInstallationHelper;


/***/ }),

/***/ 7932:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const constants_1 = __webpack_require__(2919);
/**
 * Список команд
 * @public
 */
var ACTION;
(function (ACTION) {
    // Добавить закладку в браузере
    ACTION["ADD_BOOKMARK"] = "ADD_BOOKMARK";
})(ACTION || (ACTION = {}));
class Bookmarks {
    constructor(utils) {
        this.name = 'Bookmarks';
        this._utils = utils;
    }
    execute(action_1, _a) {
        return __awaiter(this, arguments, void 0, function* (action, { url, title }) {
            if (action === ACTION.ADD_BOOKMARK) {
                // Защита от создания безымянных папок
                if (url || title) {
                    const api = this._utils.api;
                    const createBookmark = (parentId) => api.bookmarks.create({ parentId, url, title });
                    try {
                        const response = (yield api.permissions.request({
                            permissions: ['bookmarks']
                        }));
                        if (response) {
                            createBookmark('1');
                        }
                    }
                    catch (err) {
                        // Согласно https://extensionworkshop.com/documentation/
                        // develop/request-the-right-permissions/#request-permissions-at-runtime
                        // в FF permissions.request могут вызываться только внутри обработчиков пользовательских действий.
                        // Поэтому для FF bookmarks добавляем в обязательные permissions.
                        // https://bugzilla.mozilla.org/show_bug.cgi?id=1392624
                        createBookmark('toolbar_____');
                    }
                }
                return {
                    status: constants_1.ACTION_STATUS.SUCCESS
                };
            }
            return {
                status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
            };
        });
    }
}
exports["default"] = Bookmarks;


/***/ }),

/***/ 1078:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const NmhPort_1 = __webpack_require__(7377);
const buildDeferred_1 = __webpack_require__(3549);
const logger_1 = __webpack_require__(8601);
const ReconnectTracker_1 = __webpack_require__(3427);
const SabyDesktopConnection_1 = __webpack_require__(3918);
const QueryManager_1 = __webpack_require__(9633);
const localization = __webpack_require__(1949);
const ServiceFactory_1 = __webpack_require__(2284);
const constants_1 = __webpack_require__(2919);
const TabManager_1 = __webpack_require__(4608);
const SharedServiceConnection_1 = __webpack_require__(2675);
class Coordinator {
    /**
     * Запуск инициализации расширения
     * @param {ICoordinatorInit} params - Параметры инициализации
     */
    static init(_a) {
        return __awaiter(this, arguments, void 0, function* ({ modules, transport, onInitReady, api }) {
            // Инициализация общих утилит:
            yield this._initUtils(api);
            // Инициализация модуля транспорта
            yield this._initTransport(transport);
            // Инициализация модулей
            yield this._initModules(modules);
            // Диспетчеризация запросов
            this._initDispatching();
            // Выполнение браузерных особенностей
            onInitReady(this._utils);
            // Через 3 секунды после старта оповещаем вкладки о запуске расширения
            setTimeout(() => {
                this._utils.pageTransport.sendToAllTabs({
                    tab_id: constants_1.BROADCAST_TAB_ID,
                    id: constants_1.EXTENSION_LOADED_ID,
                    cmd: 'extension_loaded',
                    data: ''
                });
            }, 3000);
        });
    }
    /** Инициализация необходимых модулей */
    static _initModules() {
        return __awaiter(this, arguments, void 0, function* (modules = []) {
            if (!modules || modules.length < 1)
                return;
            modules.forEach((Module) => {
                const instance = new Module(this._utils);
                this._moduleInstances.add(instance);
            });
        });
    }
    /** Инициализация используемого транспорта */
    static _initTransport(module) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!module)
                return;
            this._utils.pageTransport = new module(this._utils);
            this._utils.serviceConnection = new SharedServiceConnection_1.SharedServiceConnection({
                pageTransport: this._utils.pageTransport,
                nmhPort: this._utils.nmhPort,
                api: this._utils.api
            });
        });
    }
    /** Инициализация утилит */
    static _initUtils(api) {
        return __awaiter(this, void 0, void 0, function* () {
            const nmhPort = new NmhPort_1.default();
            const sabyDesktopConnection = new SabyDesktopConnection_1.default(nmhPort);
            this._utils.api = api;
            this._utils.nmhPort = nmhPort;
            this._utils.localization = localization;
            this._utils.logger = logger_1.default;
            this._utils.buildDeferred = buildDeferred_1.default;
            this._utils.sabyDesktopConnection = sabyDesktopConnection;
            this._utils.queryManager = new QueryManager_1.default(sabyDesktopConnection);
            this._utils.serviceFactory = new ServiceFactory_1.ServiceFactory(this._utils.queryManager);
            this._utils.tabManager = new TabManager_1.default(this._utils.api);
        });
    }
    /** Инициализация диспетчеризации запросов */
    static _initDispatching() {
        const { nmhPort, pageTransport, sabyDesktopConnection, queryManager, serviceConnection } = this._utils;
        const reconnectTracker = new ReconnectTracker_1.default(this._utils.nmhPort);
        nmhPort.addMessageListener((msg) => {
            reconnectTracker.clearReconnectNmhTimeout();
            if (sabyDesktopConnection.isOwnMessage(msg)) {
                if (sabyDesktopConnection.parseMessage(msg) || queryManager.parseMessage(msg)) {
                    return;
                }
                return;
            }
            if (serviceConnection.onIncomeMessage(msg)) {
                return;
            }
            pageTransport.sendMessage(msg);
        });
        nmhPort.onBroadcast = (msg) => pageTransport.broadcastMessage(msg);
        pageTransport.onQuery = (msg, portName) => __awaiter(this, void 0, void 0, function* () {
            if (msg.cmd === constants_1.EXTENSION_ACTION_CMD) {
                this._parsePageActionsMessage(msg);
            }
            if (msg.cmd === 'connect' && msg.data === 'nng') {
                reconnectTracker.createReconnectNmhTimeout();
            }
            if (serviceConnection.isServicePort(portName)) {
                serviceConnection.sendOutcomeMessage(msg, portName);
            }
            else {
                nmhPort.sendMessageToNmh(msg);
            }
        });
    }
    /** Обработать сообщение с экшеном из браузера */
    static _parsePageActionsMessage(_a) {
        return __awaiter(this, arguments, void 0, function* ({ data: msgData, tab_id, id, senderId }) {
            const { payload, type, actionGuid } = JSON.parse(msgData);
            const [moduleName, actionName] = type.split('.');
            this._moduleInstances.forEach((module) => __awaiter(this, void 0, void 0, function* () {
                if (module.name === moduleName) {
                    const requestInfo = { portId: tab_id, senderId };
                    const actionResult = yield module.execute(actionName, payload, requestInfo);
                    if (actionResult) {
                        const data = JSON.stringify(Object.assign(Object.assign({}, actionResult), { actionGuid }));
                        this._utils.pageTransport.sendMessage({ id, tab_id, cmd: constants_1.ACTION_RESULT_CMD, data });
                    }
                }
            }));
        });
    }
}
Coordinator._utils = {};
Coordinator._moduleInstances = new Set();
exports["default"] = Coordinator;


/***/ }),

/***/ 7444:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const utils_1 = __webpack_require__(6715);
const constants_1 = __webpack_require__(2919);
/**
 * Список команд
 * @public
 */
var ACTION;
(function (ACTION) {
    ACTION["GET_EXTENSION_SERVICE_ID"] = "GET_EXTENSION_SERVICE_ID";
})(ACTION || (ACTION = {}));
class SabyNoticeManager {
    constructor() {
        this.name = 'SabyNoticeManager';
        this._guid = (0, utils_1.getGuid)();
    }
    execute(action) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (action) {
                case ACTION.GET_EXTENSION_SERVICE_ID:
                    return {
                        status: constants_1.ACTION_STATUS.SUCCESS,
                        data: this._guid
                    };
                default:
                    return {
                        status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
                    };
            }
        });
    }
}
exports["default"] = SabyNoticeManager;


/***/ }),

/***/ 3347:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const constants_1 = __webpack_require__(2919);
const LogRecorder_1 = __webpack_require__(2221);
/**
 * Список действий
 * @public
 */
var Action;
(function (Action) {
    Action["SaveLog"] = "SaveLog";
    Action["IsRecordActive"] = "IsRecordActive";
})(Action || (Action = {}));
/**
 * Список команд, которые могут быть отправлены в браузер
 * @public
 */
var Command;
(function (Command) {
    Command["changeRecordState"] = "changeRecordState";
})(Command || (Command = {}));
class TSHelper {
    constructor(utils) {
        this.name = 'TSHelper';
        this._logRecorder = new LogRecorder_1.LogRecorder(utils);
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            const { action, tab } = request;
            if (action === 'TOGGLE_RECORD') {
                this._logRecorder.toggleRecord(tab, sendResponse).then((recordIsActive) => {
                    const command = {
                        type: Command.changeRecordState,
                        data: recordIsActive
                    };
                    utils.pageTransport.sendToTab({
                        id: constants_1.BROADCAST_TAB_ID,
                        tab_id: tab.id,
                        cmd: 'extension_command',
                        data: JSON.stringify(command)
                    }, tab.id);
                });
                return true;
            }
            if (action === 'GET_HAR') {
                const tabId = tab.id;
                sendResponse({ action: 'HAR_RECEIVED', data: this._logRecorder.getHar(tabId) });
                return true;
            }
        });
        chrome.runtime.onMessageExternal.addListener((request) => {
            const { action, tab } = request;
            if (action === 'SET_UPLOAD_PROGRESS') {
                const { progress, uploadNumber } = request.payload;
                this._logRecorder.setUploadProgress(tab.id, progress, uploadNumber);
            }
        });
    }
    execute(action, payload, requestInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (action) {
                case Action.SaveLog:
                    this._logRecorder.addSabyLog(payload.message, requestInfo.senderId);
                    return {
                        status: constants_1.ACTION_STATUS.SUCCESS
                    };
                case Action.IsRecordActive:
                    return {
                        status: constants_1.ACTION_STATUS.SUCCESS,
                        data: yield this._logRecorder.isRecordActiveForTab(requestInfo.senderId)
                    };
                default:
                    return {
                        status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
                    };
            }
        });
    }
}
exports["default"] = TSHelper;


/***/ }),

/***/ 2221:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LogRecorder = void 0;
/**
 * Запись сетевых запросов на странице барузера.
 * Отладчик хрома подключается к текущей странице и собирает har лог.
 * Har лог также дополняется кастомным полем __sabyLogs - логами LocalService отпарвленными со страницы
 * @author Есин А.И.
 */
const har_1 = __webpack_require__(2274);
const stats_1 = __webpack_require__(3680);
const STORAGE_KEY = 'DIAGNOSTIC';
const RECORDER_VERSION = '1.0';
function getTimeStamp() {
    const date = new Date();
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
}
class LogRecorder {
    constructor(utils) {
        this._harContentByTab = {};
        this._statsByTab = {};
        this._debugListenersByTab = [];
        this._sabyLogsByTab = {};
        this._logger = utils.logger;
    }
    /**
     * Добавить в har лог LocalService
     * @param message Лог LocalService
     * @param tabId Идентификатор вкладки, с которой отправлен лог
     */
    addSabyLog(message, tabId) {
        return __awaiter(this, void 0, void 0, function* () {
            const active = yield this.isRecordActiveForTab(tabId);
            if (active) {
                if (!this._sabyLogsByTab[tabId]) {
                    this._sabyLogsByTab[tabId] = [];
                }
                this._sabyLogsByTab[tabId].push(message);
            }
        });
    }
    /**
     * Получить har лог для указанной вкладки
     * @param tabId Идентификатор вкладки
     * @returns Har лог
     */
    getHar(tabId) {
        return this._harContentByTab[tabId];
    }
    /**
     * Проверить включена ли запись сетевых запросов для указанной вкладки
     * @param tabId Идентификатор вкладки
     * @returns true если включена
     */
    isRecordActiveForTab(tabId) {
        return __awaiter(this, void 0, void 0, function* () {
            const active = yield this._isRecordActive();
            const tabs = yield this._getTabsRecordingState();
            return !!(active && (tabs === null || tabs === void 0 ? void 0 : tabs[tabId]));
        });
    }
    toggleRecord(tab, sendResponse) {
        return __awaiter(this, void 0, void 0, function* () {
            let result;
            const active = yield this._isRecordActive();
            let newTabs = yield this._getTabsRecordingState();
            const tabId = tab.id;
            if (!active && (newTabs === null || newTabs === void 0 ? void 0 : newTabs[tabId])) {
                // @ts-ignore
                chrome.debugger.onEvent.removeListener(this._debugListenersByTab[tabId]);
                chrome.debugger.detach({ tabId });
                try {
                    const host = new URL(tab.url).host;
                    const fileName = `${host}_${getTimeStamp()}.har`;
                    const harContent = new har_1.HARBuilder().create([this._statsByTab[tabId]], host);
                    const sabyLogs = this._sabyLogsByTab[tabId];
                    if (sabyLogs) {
                        harContent.log.__sabyLogs = sabyLogs;
                    }
                    this._harContentByTab[tabId] = {
                        fileName,
                        fileContent: JSON.stringify(harContent),
                        uploadProgress: 0
                    };
                    sendResponse({ action: 'RECORD_FINISHED', data: { fileName } });
                }
                catch (error) {
                    this._logger.error(error);
                }
                delete newTabs[tabId];
                delete this._statsByTab[tabId];
                delete this._sabyLogsByTab[tabId];
                yield chrome.storage.local.set({ tabs: newTabs });
                this._logger.log(`Remote debugging: Tab ${tabId} now unregistered.`);
                result = false;
            }
            else {
                //initialize the prop
                if (!newTabs) {
                    newTabs = {};
                }
                const stats = new stats_1.Stats();
                this._statsByTab[tabId] = stats;
                newTabs[tabId] = true;
                delete this._harContentByTab[tabId];
                chrome.storage.local.set({ tabs: newTabs });
                chrome.debugger.attach({ tabId }, RECORDER_VERSION, this._onAttach.bind(null, tabId));
                chrome.debugger.sendCommand({ tabId }, 'Network.enable');
                this._debugListenersByTab[tabId] = (debuggeeId, method, params) => __awaiter(this, void 0, void 0, function* () {
                    stats_1.StatsBuilder.processEvent(stats, { method, params });
                    this._statsByTab[tabId] = stats;
                    if (method === 'Network.loadingFinished') {
                        let responseBodyParams;
                        try {
                            responseBodyParams = yield chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
                                // @ts-ignore
                                requestId: params.requestId
                            });
                        }
                        catch (_a) {
                            responseBodyParams = null;
                        }
                        if (responseBodyParams) {
                            // @ts-ignore
                            const { body, base64Encoded } = responseBodyParams;
                            stats_1.StatsBuilder.processEvent(stats, {
                                method: 'Network.getResponseBody',
                                params: {
                                    // @ts-ignore
                                    requestId: params.requestId,
                                    body,
                                    base64Encoded
                                }
                            });
                        }
                    }
                });
                // @ts-ignore
                chrome.debugger.onEvent.addListener(this._debugListenersByTab[tabId]);
                chrome.debugger.onDetach.addListener((_a, reason_1) => __awaiter(this, [_a, reason_1], void 0, function* ({ tabId }, reason) {
                    delete this._harContentByTab[tabId];
                    delete this._statsByTab[tabId];
                    delete this._sabyLogsByTab[tabId];
                    const result = yield chrome.storage.local.get(['tabs']);
                    const newTabs = result.tabs;
                    delete newTabs[tabId];
                    chrome.storage.local.set({ tabs: newTabs });
                    chrome.runtime.sendMessage({ action: 'RECORD_CANCELED' });
                    // Пользователь вручную отменил отладку
                    if (reason === 'canceled_by_user') {
                        this._disableRecording();
                    }
                }));
                sendResponse({ action: 'RECORD_STARTED' });
                result = true;
            }
            return result;
        });
    }
    setUploadProgress(tabId, progress, uploadNumber) {
        if (tabId in this._harContentByTab) {
            const currProgress = this._harContentByTab[tabId].uploadProgress || 0;
            if (progress > currProgress) {
                this._harContentByTab[tabId].uploadProgress = progress;
            }
            if (uploadNumber) {
                this._harContentByTab[tabId].uploadNumber = uploadNumber;
            }
        }
    }
    _onAttach(tabId) {
        if (chrome.runtime.lastError) {
            alert(chrome.runtime.lastError.message);
            return;
        }
    }
    _isRecordActive() {
        return __awaiter(this, void 0, void 0, function* () {
            const { [STORAGE_KEY]: state } = yield chrome.storage.session.get(STORAGE_KEY);
            return state === 1;
        });
    }
    _disableRecording() {
        return __awaiter(this, void 0, void 0, function* () {
            const storage = yield chrome.storage.session.get(STORAGE_KEY);
            if (storage[STORAGE_KEY] === 1) {
                storage[STORAGE_KEY] = 0;
            }
            chrome.storage.session.set(storage);
        });
    }
    _getTabsRecordingState() {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield chrome.storage.local.get(['tabs']);
            return result.tabs;
        });
    }
}
exports.LogRecorder = LogRecorder;


/***/ }),

/***/ 2274:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Copyright (c) 2023 Andrea Cardaci <cyrus.and@gmail.com>
 * https://github.com/cyrus-and/chrome-har-capturer/
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.HARBuilder = void 0;
/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
class HARBuilder {
    create(pages, domain) {
        // HAR template
        const har = {
            log: {
                version: '1.2',
                creator: {
                    name: 'HAR Recorder',
                    version: '1.5',
                    comment: 'Records network request and generates HAR file.'
                },
                pages: [],
                entries: [],
                __sabyLogs: []
            }
        };
        // fill the HAR template each page info
        for (const [pageIndex, stats] of pages.entries()) {
            const pageId = `page_${pageIndex + 1}_${String(Math.random()).slice(2)}`;
            const log = this.parsePage(String(pageId), stats, domain);
            har.log.pages.push(log.page);
            har.log.entries.push(...log.entries);
        }
        return har;
    }
    parsePage(pageId, stats, domain) {
        var _a, _b;
        // page load started at
        //const firstRequest = stats.entries.get(stats.firstRequestId).requestParams;
        //const wallTimeMs = firstRequest.wallTime * 1000;
        //const startedDateTime = new Date(wallTimeMs).toISOString();
        // page timings
        //const onContentLoad = stats.domContentEventFiredMs - stats.firstRequestMs;
        //const onLoad = stats.loadEventFiredMs - stats.firstRequestMs;
        let startedDateTime = new Date().toISOString();
        const onContentLoad = 0;
        const onLoad = 0;
        // process this page load entries
        const entries = [...Object.values(stats.entries)]
            .map((entry) => this.parseEntry(pageId, entry))
            .filter((entry) => entry);
        if ((_a = entries === null || entries === void 0 ? void 0 : entries[0]) === null || _a === void 0 ? void 0 : _a.startedDateTime) {
            startedDateTime = (_b = entries === null || entries === void 0 ? void 0 : entries[0]) === null || _b === void 0 ? void 0 : _b.startedDateTime;
        }
        // outcome
        return {
            page: {
                id: pageId,
                title: domain,
                startedDateTime,
                pageTimings: {
                    onContentLoad,
                    onLoad
                },
                _user: stats.user
            },
            entries
        };
    }
    parseEntry(pageref, entry) {
        // skip requests without response (requestParams is always present; except
        // for WebSockets see Stats._Network_webSocketClosed)
        if (!entry.responseParams || (!entry.isWebSocket && !entry.responseFinishedS && !entry.responseFailedS)) {
            return null;
        }
        // skip entries without timing information (doc says optional)
        if (!entry.isWebSocket && !entry.responseParams.response.timing) {
            return null;
        }
        // extract common fields
        const { request } = entry.requestParams;
        const { response } = entry.responseParams;
        // fix WebSocket values since the protocol provides incomplete information
        if (entry.isWebSocket) {
            const requestStatus = entry.responseParams.response.requestHeadersText.split(' ');
            request.method = requestStatus[0];
            request.url = requestStatus[1];
            response.protocol = entry.responseParams.response.headersText.split(' ')[0];
        }
        // entry started
        const wallTimeMs = entry.requestParams.wallTime * 1000;
        const startedDateTime = new Date(wallTimeMs).toISOString();
        // HTTP version or protocol name (e.g., quic)
        const httpVersion = response.protocol || 'unknown';
        // request/response status
        const { method, url } = request;
        const { status, statusText } = response;
        // parse and measure headers
        const headers = this.parseHeaders(httpVersion, request, response);
        // check for redirections
        const redirectURL = this.getHeaderValue(response.headers, 'location', '');
        // parse query string
        const queryString = this.parseQueryString(request.url);
        // parse post data
        const postData = this.parsePostData(request, headers);
        // compute entry timings
        const { time, timings } = this.computeTimings(entry);
        // fetch connection information (strip IPv6 [...])
        let serverIPAddress = response.remoteIPAddress;
        if (serverIPAddress) {
            serverIPAddress = serverIPAddress.replace(/^\[(.*)\]$/, '$1');
        }
        const connection = String(response.connectionId);
        // fetch entry initiator
        const _initiator = entry.requestParams.initiator;
        // fetch resource priority
        const { changedPriority } = entry;
        const newPriority = changedPriority && changedPriority.newPriority;
        const _priority = newPriority || request.initialPriority;
        let _resourceType = entry.requestParams.type ? entry.requestParams.type.toLowerCase() : undefined;
        // parse and measure payloads
        const payload = this.computePayload(entry, headers);
        const { mimeType } = response;
        const encoding = entry.responseBodyIsBase64 ? 'base64' : undefined;
        // add WebSocket frames
        let _webSocketMessages;
        if (entry.isWebSocket) {
            _webSocketMessages = entry.frames;
            _resourceType = 'websocket';
        }
        // fill entry
        return {
            pageref,
            startedDateTime,
            time,
            request: {
                method,
                url,
                httpVersion,
                cookies: [], // TODO
                headers: headers.request.pairs,
                queryString,
                headersSize: headers.request.size,
                bodySize: payload.request.bodySize,
                postData
            },
            response: {
                status,
                statusText,
                httpVersion,
                cookies: [], // TODO
                headers: headers.response.pairs,
                redirectURL,
                headersSize: headers.response.size,
                bodySize: payload.response.bodySize,
                _transferSize: payload.response.transferSize,
                content: {
                    size: entry.responseLength,
                    mimeType: entry.isWebSocket ? 'x-unknown' : mimeType,
                    compression: payload.response.compression,
                    text: entry.responseBody,
                    encoding
                }
            },
            cache: {},
            _fromDiskCache: response.fromDiskCache,
            timings,
            serverIPAddress,
            connection,
            _initiator,
            _priority,
            _webSocketMessages,
            _resourceType
        };
    }
    parseHeaders(httpVersion, request, response) {
        // convert headers from map to pairs
        const requestHeaders = response.requestHeaders || request.headers;
        const responseHeaders = response.headers;
        const headers = {
            request: {
                map: requestHeaders,
                pairs: this.zipNameValue(requestHeaders),
                size: -1
            },
            response: {
                map: responseHeaders,
                pairs: this.zipNameValue(responseHeaders),
                size: -1
            }
        };
        // estimate the header size (including HTTP status line) according to the
        // protocol (this information not available due to possible compression in
        // newer versions of HTTP)
        if (httpVersion.match(/^http\/[01].[01]$/)) {
            const requestText = this.getRawRequest(request, headers.request.pairs);
            const responseText = this.getRawResponse(response, headers.response.pairs);
            headers.request.size = requestText.length;
            headers.response.size = responseText.length;
        }
        return headers;
    }
    computeTimings(entry) {
        // handle the websocket case specially
        if (entry.isWebSocket) {
            // from initial request to the last frame, this is obviously an
            // approximation, but HAR does not directly support WebSockets
            const sessionTime = entry.frames.length === 0
                ? -1
                : this.toMilliseconds(entry.frames[entry.frames.length - 1].time - entry.requestParams.timestamp);
            return {
                time: sessionTime,
                timings: {
                    blocked: -1,
                    dns: -1,
                    connect: -1,
                    send: 0,
                    wait: sessionTime,
                    receive: -1, // XXX does not really make sense for WebSockets...
                    ssl: -1
                }
            };
        }
        // see https://github.com/ChromeDevTools/devtools-frontend/blob/29fab47578afb1ead4eb63414ec30cada4814b62/front_end/sdk/HARLog.js#L255-L329
        const timing = entry.responseParams.response.timing;
        // compute the total duration (including blocking time)
        const finishedTimestamp = entry.responseFinishedS || entry.responseFailedS;
        const time = this.toMilliseconds(finishedTimestamp - entry.requestParams.timestamp);
        // compute individual components
        const blockedBase = this.toMilliseconds(timing.requestTime - entry.requestParams.timestamp);
        const blockedStart = this.firstNonNegative([timing.dnsStart, timing.connectStart, timing.sendStart]);
        const blocked = blockedBase + (blockedStart === -1 ? 0 : blockedStart);
        let dns = -1;
        if (timing.dnsStart >= 0) {
            const start = this.firstNonNegative([timing.connectStart, timing.sendStart]);
            dns = start - timing.dnsStart;
        }
        let connect = -1;
        if (timing.connectStart >= 0) {
            connect = timing.sendStart - timing.connectStart;
        }
        const send = timing.sendEnd - timing.sendStart;
        const wait = timing.receiveHeadersEnd - timing.sendEnd;
        const receive = this.toMilliseconds(finishedTimestamp - (timing.requestTime + timing.receiveHeadersEnd / 1000));
        let ssl = -1;
        if (timing.sslStart >= 0 && timing.sslEnd >= 0) {
            ssl = timing.sslEnd - timing.sslStart;
        }
        return {
            time,
            timings: { blocked, dns, connect, send, wait, receive, ssl }
        };
    }
    computePayload(entry, headers) {
        // From Chrome:
        //  - responseHeaders.size: size of the headers if available (otherwise
        //    -1, e.g., HTTP/2)
        //  - entry.responseLength: actual *decoded* body size
        //  - entry.encodedResponseLength: total on-the-wire data
        //
        // To HAR:
        //  - headersSize: size of the headers if available (otherwise -1, e.g.,
        //    HTTP/2)
        //  - bodySize: *encoded* body size
        //  - _transferSize: total on-the-wire data
        //  - content.size: *decoded* body size
        //  - content.compression: *decoded* body size - *encoded* body size
        let bodySize;
        let compression;
        let transferSize = entry.encodedResponseLength;
        if (headers.response.size === -1) {
            // if the headers size is not available (e.g., newer versions of
            // HTTP) then there is no way (?) to figure out the encoded body
            // size (see #27)
            bodySize = -1;
            compression = undefined;
        }
        else if (entry.responseFailedS) {
            // for failed requests (`Network.loadingFailed`) the transferSize is
            // just the header size, since that evend does not hold the
            // `encodedDataLength` field, this is performed manually (however this
            // cannot be done for HTTP/2 which is handled by the above if)
            bodySize = 0;
            compression = 0;
            transferSize = headers.response.size;
        }
        else {
            // otherwise the encoded body size can be obtained as follows
            bodySize = entry.encodedResponseLength - headers.response.size;
            compression = entry.responseLength - bodySize;
        }
        return {
            request: {
                // trivial case for request
                bodySize: parseInt(this.getHeaderValue(headers.request.map, 'content-length', -1), 10)
            },
            response: {
                bodySize,
                transferSize,
                compression
            }
        };
    }
    zipNameValue(map) {
        const pairs = [];
        for (const [name, value] of Object.entries(map)) {
            // insert multiple pairs if the key is repeated
            const values = Array.isArray(value) ? value : [value];
            for (const value of values) {
                pairs.push({ name, value });
            }
        }
        return pairs;
    }
    parseQuery(query) {
        var _a;
        let mapQueryString = (_a = query.split('&')) === null || _a === void 0 ? void 0 : _a.map(function (nameValue) {
            let nameValuePair = nameValue.split('=').map(decodeURIComponent);
            return { [nameValuePair[0]]: nameValuePair[1] };
        });
        return mapQueryString;
    }
    getRawRequest(request, headerPairs) {
        const { method, url, protocol } = request;
        const lines = [`${method} ${url} ${protocol}`];
        for (const { name, value } of headerPairs) {
            lines.push(`${name}: ${value}`);
        }
        lines.push('', '');
        return lines.join('\r\n');
    }
    getRawResponse(response, headerPairs) {
        const { status, statusText, protocol } = response;
        const lines = [`${protocol} ${status} ${statusText}`];
        for (const { name, value } of headerPairs) {
            lines.push(`${name}: ${value}`);
        }
        lines.push('', '');
        return lines.join('\r\n');
    }
    getHeaderValue(headers, name, fallback) {
        const pattern = new RegExp(`^${name}$`, 'i');
        const key = Object.keys(headers).find((name) => {
            return name.match(pattern);
        });
        return key === undefined ? fallback : headers[key];
    }
    parseQueryString(requestUrl) {
        const url = new URL(requestUrl);
        let map = {};
        for (const pair of url.searchParams.entries()) {
            map = Object.assign(Object.assign({}, map), { [pair[0]]: pair[1] });
        }
        return this.zipNameValue(map);
    }
    parsePostData(request, headers) {
        const { postData } = request;
        if (!postData) {
            return undefined;
        }
        const mimeType = this.getHeaderValue(headers.request.map, 'content-type');
        const params = mimeType === 'application/x-www-form-urlencoded' ? this.zipNameValue(this.parseQuery(postData)) : [];
        return {
            mimeType,
            params,
            text: postData
        };
    }
    firstNonNegative(values) {
        const value = values.find((value) => value >= 0);
        return value === undefined ? -1 : value;
    }
    toMilliseconds(time) {
        return time < 0 ? -1 : time * 1000;
    }
}
exports.HARBuilder = HARBuilder;


/***/ }),

/***/ 3680:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Copyright (c) 2023 Andrea Cardaci <cyrus.and@gmail.com>
 * https://github.com/cyrus-and/chrome-har-capturer/
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.StatsBuilder = exports.Stats = void 0;
/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
class Stats {
    constructor(url, options) {
        this._options = options;
        this._responseBodyCounter = 0;
        this.url = url;
        this.firstRequestId = undefined;
        this.firstRequestMs = undefined;
        this.domContentEventFiredMs = undefined;
        this.loadEventFiredMs = undefined;
        this.entries = new Map();
        this.user = undefined; // filled from outside
    }
}
exports.Stats = Stats;
class StatsBuilder {
    static processEvent(stats, { method, params }) {
        const methodName = `_${method.replace('.', '_')}`;
        const handler = StatsBuilder[methodName];
        if (handler) {
            handler(stats, params);
        }
    }
    static _Page_domContentEventFired(stats, params) {
        const { timestamp } = params;
        stats.domContentEventFiredMs = timestamp * 1000;
    }
    static _Page_loadEventFired(stats, params) {
        const { timestamp } = params;
        stats.loadEventFiredMs = timestamp * 1000;
    }
    static _Network_requestWillBeSent(stats, params) {
        const { requestId, initiator, timestamp, redirectResponse } = params;
        // skip data URI
        if (params.request.url.match('^data:')) {
            return;
        }
        // the first is the first request
        if (!stats.firstRequestId && initiator.type === 'other') {
            stats.firstRequestMs = timestamp * 1000;
            stats.firstRequestId = requestId;
        }
        // redirect responses are delivered along the next request
        if (redirectResponse) {
            const redirectEntry = stats.entries[requestId];
            // craft a synthetic response params
            redirectEntry.responseParams = {
                response: redirectResponse
            };
            // set the redirect response finished when the redirect
            // request *will be sent* (this may be an approximation)
            redirectEntry.responseFinishedS = timestamp;
            redirectEntry.encodedResponseLength = redirectResponse.encodedDataLength;
            // since Chrome uses the same request id for all the
            // redirect requests, it is necessary to disambiguate
            const newId = requestId + '_redirect_' + timestamp;
            // rename the previous metadata entry
            stats.entries[newId] = redirectEntry;
            delete stats.entries[requestId];
        }
        // initialize this entry
        stats.entries[requestId] = {
            requestParams: params,
            responseParams: undefined,
            responseLength: 0, // built incrementally
            encodedResponseLength: undefined,
            responseFinishedS: undefined,
            responseBody: undefined,
            responseBodyIsBase64: undefined,
            newPriority: undefined
        };
    }
    static _Network_dataReceived(stats, params) {
        const { requestId, dataLength } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.responseLength += dataLength;
    }
    static _Network_responseReceived(stats, params) {
        const entry = stats.entries[params.requestId];
        if (!entry) {
            return;
        }
        entry.responseParams = params;
    }
    static _Network_resourceChangedPriority(stats, params) {
        const { requestId, newPriority } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.newPriority = newPriority;
    }
    static _Network_loadingFinished(stats, params) {
        const { requestId, timestamp, encodedDataLength } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.encodedResponseLength = encodedDataLength;
        entry.responseFinishedS = timestamp;
        // check termination condition
        stats._responseBodyCounter++;
    }
    static _Network_loadingFailed(stats, params) {
        const { requestId, errorText, canceled, timestamp } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.responseFailedS = timestamp;
    }
    static _Network_getResponseBody(stats, params) {
        const { requestId, body, base64Encoded } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.responseBody = body;
        entry.responseBodyIsBase64 = base64Encoded;
        // check termination condition
        stats._responseBodyCounter--;
    }
    static _Network_webSocketWillSendHandshakeRequest(stats, params) {
        // initialize this entry (copied from requestWillbesent)
        stats.entries[params.requestId] = {
            isWebSocket: true,
            frames: [],
            requestParams: params,
            responseParams: undefined,
            responseLength: 0, // built incrementally
            encodedResponseLength: undefined,
            responseFinishedS: undefined,
            responseBody: undefined,
            responseBodyIsBase64: undefined,
            newPriority: undefined
        };
    }
    static _Network_webSocketHandshakeResponseReceived(stats, params) {
        // reuse the general handler
        StatsBuilder._Network_responseReceived(stats, params);
    }
    static _Network_webSocketClosed(stats, params) {
        const { requestId, timestamp } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        // XXX keep track of the whole WebSocket session duration, failure to
        // receive this message though must not discard the entry since the page
        // loading event may happen well before the actual WebSocket termination
        entry.responseFinishedS = timestamp;
    }
    static _Network_webSocketFrameSent(stats, params) {
        const { requestId, timestamp, response } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.frames.push({
            type: 'send',
            time: timestamp,
            opcode: response.opcode,
            data: response.payloadData
        });
    }
    static _Network_webSocketFrameReceived(stats, params) {
        const { requestId, timestamp, response } = params;
        const entry = stats.entries[requestId];
        if (!entry) {
            return;
        }
        entry.frames.push({
            type: 'receive',
            time: timestamp,
            opcode: response.opcode,
            data: response.payloadData
        });
    }
}
exports.StatsBuilder = StatsBuilder;


/***/ }),

/***/ 3280:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ACTION = void 0;
const constants_1 = __webpack_require__(2919);
/**
 * Список команд
 * @public
 */
var ACTION;
(function (ACTION) {
    // Поднять окно браузера
    ACTION["SET_FOREGROUND_WINDOW"] = "SET_FOREGROUND_WINDOW";
    // Вернуть фокус на текущую вкладку браузера
    ACTION["FOCUS_ON_TAB"] = "FOCUS_ON_TAB";
    // Открыть новую вкладку
    ACTION["OPEN_NEW_TAB"] = "OPEN_NEW_TAB";
})(ACTION || (exports.ACTION = ACTION = {}));
class WindowManager {
    constructor(utils) {
        this.name = 'WindowManager';
        this._utils = utils;
    }
    execute(action, payload, requestInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (action) {
                case ACTION.FOCUS_ON_TAB:
                    return this._setFocusOnTab(requestInfo);
                case ACTION.OPEN_NEW_TAB:
                    return this._openNewTab(payload, requestInfo);
                case ACTION.SET_FOREGROUND_WINDOW:
                    return this._setForegroundWindow(requestInfo);
                default:
                    return {
                        status: constants_1.ACTION_STATUS.UNKNOWN_ACTION
                    };
            }
        });
    }
    _setFocusOnTab(requestInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(requestInfo === null || requestInfo === void 0 ? void 0 : requestInfo.portId)) {
                return {
                    status: constants_1.ACTION_STATUS.FAIL
                };
            }
            const windowId = yield this._utils.pageTransport.getWindowIdByPort(requestInfo.portId);
            if (windowId) {
                this._utils.api.windows.update(windowId, { focused: true, state: 'maximized' });
            }
            const tabId = yield this._utils.pageTransport.getTabIdByPort(requestInfo.portId);
            if (tabId) {
                this._utils.api.tabs.update(tabId, { active: true });
            }
            return {
                status: constants_1.ACTION_STATUS.SUCCESS
            };
        });
    }
    _openNewTab(payload, requestInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(requestInfo === null || requestInfo === void 0 ? void 0 : requestInfo.portId)) {
                return {
                    status: constants_1.ACTION_STATUS.FAIL
                };
            }
            const windowId = yield this._utils.pageTransport.getWindowIdByPort(requestInfo.portId);
            if (windowId) {
                this._utils.tabManager.openNewTab(payload.url, windowId);
            }
            return {
                status: constants_1.ACTION_STATUS.SUCCESS
            };
        });
    }
    _setForegroundWindow(requestInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(requestInfo === null || requestInfo === void 0 ? void 0 : requestInfo.portId)) {
                return {
                    status: constants_1.ACTION_STATUS.FAIL
                };
            }
            const windowId = yield this._utils.pageTransport.getWindowIdByPort(requestInfo.portId);
            if (windowId) {
                this._utils.api.windows.update(windowId, { focused: true });
            }
            return {
                status: constants_1.ACTION_STATUS.SUCCESS
            };
        });
    }
}
exports["default"] = WindowManager;


/***/ }),

/***/ 3510:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const constants_1 = __webpack_require__(2919);
let autoIncrement = 0;
const dummy = () => {
    return;
};
/**
 * Транспорт, реализующий обмен сообщениями со страницей через долгоживущие соединения
 * @author Есин А.И.
 */
class LongLivedTransport {
    constructor({ logger }) {
        this.onQuery = dummy;
        this._ports = new Map();
        this._logger = null;
        this._portNamesById = {};
        this._logger = logger;
        this._onPortMessage = this._onPortMessage.bind(this);
        chrome.runtime.onConnectExternal.addListener((port) => {
            this._registerPort(port);
        });
        chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
            if (request === 'checkBackground') {
                sendResponse(true);
            }
        });
    }
    broadcastMessage(message) {
        this._ports.forEach((port) => {
            port.postMessage(message);
        });
    }
    sendToAllTabs(message) {
        const manifest = chrome.runtime.getManifest();
        const matches = (manifest === null || manifest === void 0 ? void 0 : manifest.content_scripts) && (manifest === null || manifest === void 0 ? void 0 : manifest.content_scripts[0].matches);
        chrome.tabs.query({ url: matches }, (foundTabs) => {
            foundTabs.forEach((tab) => {
                const tabId = tab.id;
                if (tabId) {
                    message.type = 'FROM_BACKGROUND_SCRIPT_TO_CONTENT_SCRIPT';
                    chrome.tabs.sendMessage(tabId, message);
                }
            });
        });
    }
    sendMessage(message) {
        const portId = message.tab_id;
        // Перезаписать направление передачи сообщения
        message.type = 'FROM_BACKGROUND_SCRIPT_TO_CONTENT_SCRIPT';
        try {
            const port = this._ports.get(portId);
            if (port) {
                this._logger.debug('PagePort:Send message', message);
                port.postMessage(message);
                return true;
            }
            else {
                this._logger.debug('PagePort:received data from NMH is bad', message);
            }
        }
        catch (err) {
            this._logger.error('Send message to content fail (' + err.name + ') : ' + err.message);
        }
        return false;
    }
    sendToTab(message, tabId) {
        let dataSent = false;
        this._ports.forEach((port) => {
            var _a, _b;
            if (((_b = (_a = port.sender) === null || _a === void 0 ? void 0 : _a.tab) === null || _b === void 0 ? void 0 : _b.id) === tabId) {
                if (!dataSent) {
                    dataSent = true;
                }
                port.postMessage(message);
            }
        });
        return dataSent;
    }
    getWindowIdByPort(portId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const port = this._ports.get(portId);
            return (_b = (_a = port === null || port === void 0 ? void 0 : port.sender) === null || _a === void 0 ? void 0 : _a.tab) === null || _b === void 0 ? void 0 : _b.windowId;
        });
    }
    getTabIdByPort(portId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const port = this._ports.get(portId);
            return (_b = (_a = port === null || port === void 0 ? void 0 : port.sender) === null || _a === void 0 ? void 0 : _a.tab) === null || _b === void 0 ? void 0 : _b.id;
        });
    }
    /**
     * Зарегистрировать новый порт
     * @param port
     * @private
     */
    _registerPort(port) {
        const id = autoIncrement++;
        const originalName = port.name;
        port.name = id.toString();
        this._ports.set(id, port);
        this._portNamesById[id] = originalName;
        port.onMessage.addListener(this._onPortMessage);
        port.onDisconnect.addListener((port) => {
            port.onMessage.removeListener(this._onPortMessage);
            this._unregisterPort(id);
            this.onQuery({ tab_id: id, id: constants_1.BROADCAST_TAB_ID, cmd: 'disconnect', data: '' }, originalName);
        });
    }
    /**
     * Удалить порт
     * @param portId
     * @private
     */
    _unregisterPort(portId) {
        this._ports.delete(portId);
        delete this._portNamesById[portId];
    }
    /**
     * Обработчик сообщения, пришедшего в порт
     * @param message
     * @param port
     * @private
     */
    _onPortMessage(message, port) {
        var _a, _b, _c;
        this._logger.debug('PagePort:Receive message', message);
        // Добавить в сообщение идентификатор сессии
        const portId = parseInt(port.name, 10);
        message.tab_id = portId;
        // Добавляем в сообщение origin
        message.origin = (_a = port.sender) === null || _a === void 0 ? void 0 : _a.origin;
        message.senderId = (_c = (_b = port.sender) === null || _b === void 0 ? void 0 : _b.tab) === null || _c === void 0 ? void 0 : _c.id;
        this.onQuery(message, this._portNamesById[portId]);
    }
}
exports["default"] = LongLivedTransport;


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
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
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
 * Фоновый скрипт для расширения в chrome
 * @author Клименко И.А.
 */
const Coordinator_1 = __webpack_require__(1078);
const Bookmarks_1 = __webpack_require__(7932);
const LongLivedTransport_1 = __webpack_require__(3510);
const chromeFeatures_1 = __webpack_require__(6816);
const WindowManager_1 = __webpack_require__(3280);
const AppInstallationHelper_1 = __webpack_require__(494);
const TSHelper_1 = __webpack_require__(3347);
const ActivityChrome_1 = __webpack_require__(5603);
const SabyNoticeManager_1 = __webpack_require__(7444);
Coordinator_1.default.init({
    modules: [Bookmarks_1.default, WindowManager_1.default, AppInstallationHelper_1.default, TSHelper_1.default, ActivityChrome_1.default, SabyNoticeManager_1.default],
    transport: LongLivedTransport_1.default,
    onInitReady: chromeFeatures_1.default,
    api: chrome
});

})();

/******/ })()
;