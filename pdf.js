'use strict';
var nodeUtil = require("util"),
    nodeEvents = require("events"),
    fs = require('fs'),
    _ = require('underscore'),
    DOMParser = require('./../node_modules/xmldom').DOMParser,
    PDFCanvas = require('./pdfcanvas.js'),
    PDFUnit = require('./pdfunit.js');

var _pdfjsFiles = [
    'core.js',
    'util.js',
    'api.js',
    'metadata.js',
    'canvas.js',
    'obj.js',
    'function.js',
    'charsets.js',
    'colorspace.js',
    'crypto.js',
    'evaluator.js',
    'fonts.js',
    'glyphlist.js',
    'image.js',
    'metrics.js',
    'parser.js',
    'pattern.js',
    'stream.js',
    'worker.js',
    'jpg.js'
];

//////replacing HTML5 canvas with PDFCanvas (in-memory canvas)
function createScratchCanvas(width, height) { return new PDFCanvas({}, width, height); }

var PDFJS = {};
var globalScope = {};

var _basePath = __dirname + "/pdfjs/";
var _fileContent = '';
_.each(_pdfjsFiles, function(fielName, idx) {
    _fileContent += fs.readFileSync(_basePath + fielName, 'utf8');
});

eval(_fileContent);

////////////////////////////////start of helper classes
var PDFPageParser = (function () {
    // private static
    var _nextId = 1;
    var _name = 'PDFPageParser';

    var RenderingStates = {
      INITIAL: 0,
      RUNNING: 1,
      PAUSED: 2,
      FINISHED: 3
    };

    // constructor
    var cls = function (pdfPage, id, scale) {
        nodeEvents.EventEmitter.call(this);
        // private
        var _id = _nextId++;

        // public (every instance will have their own copy of these methods, needs to be lightweight)
        this.get_id = function() { return _id; };
        this.get_name = function() { return _name + _id; };

        // public, this instance copies
        this.id = id;
        this.pdfPage = pdfPage;

        this.scale = scale || 1.0;

        this.viewport = this.pdfPage.getViewport(this.scale, 0);

        this.renderingState = RenderingStates.INITIAL;

        //public properties
        Object.defineProperty(this, 'width', {
            get:function () {
                return PDFUnit.toFormX(this.viewport.width);
            },
            enumerable:true
        });

        Object.defineProperty(this, 'height', {
            get:function () {
                return PDFUnit.toFormY(this.viewport.height);
            },
            enumerable:true
        });
    };
    // inherit from event emitter
	nodeUtil.inherits(cls, nodeEvents.EventEmitter);

    cls.prototype.destroy = function() {
        this.pdfPage.destroy();
    };

    cls.prototype.getPagePoint = function(x, y) {
        return this.viewport.convertToPdfPoint(x, y);
    };

    cls.prototype.parsePage = function(callback) {
        if (this.renderingState !== RenderingStates.INITIAL)
          error('Must be in new state before drawing');

        this.renderingState = RenderingStates.RUNNING;

        var canvas = createScratchCanvas(1, 1);
        var ctx = canvas.getContext('2d');

        var self = this;

        function pageViewDrawCallback(error) {
            self.renderingState = RenderingStates.FINISHED;

            if (error) {
                nodeUtil._logN.call(self, 'An error occurred while rendering the page.' + error);
            }
            else {
                nodeUtil._logN.call(self, 'pdfPage of ' + self.id + ' is rendered successfully.');
                _.extend(self, ctx.canvas);

            }

            self.stats = self.pdfPage.stats;
            callback();
        }

        var renderContext = {
            canvasContext:ctx,
            viewport:this.viewport
        };

        this.pdfPage.render(renderContext).then(
            function pdfPageRenderCallback() {
                pageViewDrawCallback(null);
            },
            function pdfPageRenderError(error) {
                pageViewDrawCallback(error);
            }
        );
    };

    return cls;

})();

////////////////////////////////Start of Node.js Module
var PDFJSClass = (function () {
    // private static
    var _nextId = 1;
    var _name = 'PDFJSClass';

    // constructor
    var cls = function () {
        nodeEvents.EventEmitter.call(this);
        // private
        var _id = _nextId++;

        // public (every instance will have their own copy of these methods, needs to be lightweight)
        this.get_id = function() { return _id; };
        this.get_name = function() { return _name + _id; };

        // public, this instance copies
        this.pdfDocument = null;
        this.formImage = null;
    };
    // inherit from event emitter
	nodeUtil.inherits(cls, nodeEvents.EventEmitter);

    cls.prototype.checkType = function() {
        nodeUtil._logN.call(this, "typeof(PDFJS.getDocument) == " + typeof(PDFJS.getDocument));
    };

    cls.prototype.parsePDFData = function(arrayBuffer) {
        var parameters = {password: '', data: arrayBuffer};
        this.pdfDocument = null;
        this.formImage = null;
        var self = this;
        PDFJS.getDocument(parameters).then(
            function getDocumentCallback(pdfDocument) {
                nodeUtil._logN.call(self, "getDocumentCallback(" + typeof pdfDocument + ")");
                self.load(pdfDocument, 1);
            },
            function getDocumentError(message, exception) {
                nodeUtil._logN.call(self, "An error occurred while parsing the PDF: " + message);
            },
            function getDocumentProgress(progressData) {
                nodeUtil._logN.call(self, "Loading progress: " + progressData.loaded / progressData.total + "%");
            }
        );
    };

    cls.prototype.load = function(pdfDocument, scale) {
        this.pdfDocument = pdfDocument;

        var pages = this.pages = [];
        this.pageWidth = 0;

        var pagesCount = pdfDocument.numPages;
        var pagePromises = [];
        for (var i = 1; i <= pagesCount; i++)
          pagePromises.push(pdfDocument.getPage(i));

        var self = this;
        var pagesPromise = PDFJS.Promise.all(pagePromises);

        nodeUtil._logN.call(self, "load: pagesCount = " + pagesCount);

        pagesPromise.then(function(promisedPages) {
            self.parsePage(promisedPages, 0, 1.5);
        });

        pdfDocument.getMetadata().then(function(data) {
            var info = data.info, metadata = data.metadata;
            self.documentInfo = info;
            self.metadata = metadata;

            var pdfTile = "";
            if (metadata && metadata.has('dc:title')) {
                pdfTile = metadata.get('dc:title');
            }
            else if (info && info['Title'])
                pdfTile = info['Title'];

            self.emit("pdfjs_parseDataReady", {Agency:pdfTile, Id: info});
        });
    };

    cls.prototype.parsePage = function(promisedPages, id, scale) {
        nodeUtil._logN.call(this, "parsePage:" + id);
        var self = this;
        var pdfPage = promisedPages[id];
        var pageParser = new PDFPageParser(pdfPage, id, scale);
        pageParser.parsePage(function() {
            if (!self.pageWidth)  //get PDF width
                self.pageWidth = pageParser.width;

            var page = {Height: pageParser.height};

            _.extend(page, {HLines: pageParser.HLines,
                VLines: pageParser.VLines,
                Fills:pageParser.Fills,
                Texts: pageParser.Texts
                });

            self.pages.push(page);

            if (id == self.pdfDocument.numPages - 1) {
                self.emit("pdfjs_parseDataReady", {Pages:self.pages, Width: self.pageWidth});
            }
            else {
                process.nextTick(function(){
                    self.parsePage(promisedPages, ++id, scale);
                });
            }
        });
    };

    return cls;
})();

module.exports = PDFJSClass;
////////////////////////////////End of Node.js Module