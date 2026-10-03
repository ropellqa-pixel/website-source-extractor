(function() {
    var nextId = 1;
    var ports = {};
    var _browser = (!!window.chrome && !!chrome.runtime) ? chrome : browser;
    var extId = _browser.runtime.id;
    var handlers = {};
    var objId = "C3B7563B-BF85-45B7-88FC-7CFF1BD3C2DB"

    window.addEventListener("message", function (event) {
        if (event.source != window || typeof event.data === "undefined") { return; }

        if (typeof event.data.rutoken === "undefined"
            || typeof event.data.rutoken.ext === "undefined" || event.data.rutoken.ext !== extId
            || typeof event.data.rutoken.source === "undefined" || event.data.rutoken.source !== "webpage"
            || typeof event.data.rutoken.action === "undefined") {
            return;
        }

        var handler = handlers[event.data.rutoken.action];
        if (handler) {
            handler(event.data.rutoken);
        } else {
            console.warn("Unknown action: " + event.data.rutoken.action);
        }
    }, false);

    handlers.initialize = function () {
        includeFile("webpage.js");
    };

    handlers.createWyrmhole = function () {
        var portName = "FireWyrmPort" + (nextId++);
        var port = _browser.runtime.connect(extId, {name: portName});
        ports[portName] = port;

        window.postMessage({ rutoken: {
            ext: extId,
            source: "content",
            event: "created",
            port: portName
        } }, "*");

        port.onMessage.addListener(function (msg) {
            // Message from the background script received, post it to the page
            window.postMessage({ rutoken: {
                ext: extId,
                source: "content",
                event: "message",
                port: portName,
                message: msg
            } }, "*");
        });

        port.onDisconnect.addListener(function () {
            // The host port disconnected; tell the window
            window.postMessage({ rutoken: {
                ext: extId,
                source: "content",
                event: "disconnected",
                port: portName
            } }, "*");
            delete ports[portName];
        });
    };

    handlers.sendToPort = function (data) {
        var port = data.port;
        if (ports[port]) {
            // Message from the page received, post it to the background script
            ports[port].postMessage(data.message);
        } else {
            console.warn("Invalid port: " + port);
        }
    };

    function includeFile(file) {
        var s = document.createElement('script');
        s.src = _browser.runtime.getURL(file);
        s.onload = function() {
           this.parentNode.removeChild(this);
        };
        (document.head||document.documentElement).appendChild(s);
    }

    if (_browser.runtime.getManifest().manifest_version == 2) {
        var s = document.createElement('script');
        s.textContent = `(function (extId, objId) {
    var extension = window[extId] = window[objId] = {};

    extension.initialize = function () {
        if (extension.initializePromise) {
            throw "initialise has already been called";
        }

        extension.initializePromise = {};

        return new Promise(function (resolve, reject) {
            extension.initializePromise.resolve = resolve;
            extension.initializePromise.reject = reject;

            window.postMessage({ rutoken: { ext: extId, source: "webpage", action: "initialize" } }, "*");
        });
    }
}) ("ohedcglhbbfdgaogjhcclacoccbagkjg", "C3B7563B-BF85-45B7-88FC-7CFF1BD3C2DB");
`;
        s.onload = function() {
           this.parentNode.removeChild(this);
        };
        (document.head||document.documentElement).appendChild(s);
        s.parentNode.removeChild(s);
    }
})();
