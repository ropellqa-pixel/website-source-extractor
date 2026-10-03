(function (extId, objId) {
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
