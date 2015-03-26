// Modification credits to this post.
// http://stackoverflow.com/questions/23449065/reassemble-binary-after-flow-js-upload-on-node-express-server
var tempFolder = 'tmp';
var appPrefix = 'flow-';

process.env.TMPDIR = tempFolder; // to avoid the EXDEV rename error, see http://stackoverflow.com/q/21071303/76173

var fs = require('fs');
var path = require('path');
var express = require('express');
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();
var flow = require('./flow-node.js')(tempFolder);
var app = express();
var ACCESS_CONTROLL_ALLOW_ORIGIN = false;
var reassembleFileAfterPost = true;
var removeChunksAfterPost = false; // Not fully supported do to extra logic required for download route/method.

// Host most stuff in the public folder
app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname + '/../../src'));

// Handle uploads through Flow.js
app.post('/upload', multipartMiddleware, function (req, res) {
    flow.post(req, function (status, filename, original_filename, identifier, currentTestChunk, numberOfChunks) {
        console.log('Flow: POST', status, original_filename, identifier, currentTestChunk, numberOfChunks);
        if (ACCESS_CONTROLL_ALLOW_ORIGIN) {
            res.header('Access-Control-Allow-Origin', '*');
        }
        res.status(status).send();

        if (reassembleFileAfterPost && status === 'done' && currentTestChunk > numberOfChunks) {
            // The folder is guaranteed to be there from the upload, so no need to check.
            var fileFolder = path.join('./', tempFolder, appPrefix + identifier);
            var stream = fs.createWriteStream(fileFolder + '/' + filename);

            // EDIT: I removed options {end: true} because it isn't needed
            // and added {onDone: flow.clean} to remove the chunks after writing
            // the file.
            flow.write(identifier, stream, {onDone: removeChunksAfterPost ? flow.clean : null});
        }
    });
});

app.options('/upload', function (req, res) {
    console.log('Server: Options');
    if (ACCESS_CONTROLL_ALLOW_ORIGIN) {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.status(200).send();
});

// Handle status checks on chunks through Flow.js
app.get('/upload', function (req, res) {
    flow.get(req, function (status, filename, original_filename, identifier) {
        console.log('Flow: GET', status);
        if (ACCESS_CONTROLL_ALLOW_ORIGIN) {
            res.header('Access-Control-Allow-Origin', '*');
        }

        if (status == 'found') {
            status = 200;
        } else {
            status = 404;
        }

        res.status(status).send();
    });
});

app.get('/download/:identifier', function (req, res) {
    console.log('Server: Download');
    flow.write(req.params.identifier, res);
});

app.listen(3000);
