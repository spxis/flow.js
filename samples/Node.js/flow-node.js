// Modification credits to this post.
// http://stackoverflow.com/questions/23449065/reassemble-binary-after-flow-js-upload-on-node-express-server

var fs = require('fs');
var path = require('path');
var util = require('util');
var Stream = require('stream').Stream;

module.exports = flow = function (temporaryFolder) {
    var $ = this;
    $.temporaryFolder = temporaryFolder;
    $.maxFileSize = null;
    $.fileParameterName = 'file';

    console.log('flow.init() - temp folder: %s', $.temporaryFolder);

    try {
        fs.mkdirSync($.temporaryFolder);
    } catch (e) {

    }

    function cleanIdentifier(identifier) {
        return identifier.replace(/[^0-9A-Za-z_-]/g, '');
    }

    function getChunkFilename(chunkNumber, identifier) {
        // Clean up the identifier
        identifier = cleanIdentifier(identifier);
        // What would the file name be?
        return path.resolve($.temporaryFolder, './flow-' + identifier + '.' + chunkNumber);
    }

    function validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, fileSize) {
        console.log('flow.validateRequest(): %s, %s, %s, %s, %s, %s', chunkNumber, chunkSize, totalSize, identifier, filename, fileSize);

        // Clean up the identifier
        identifier = cleanIdentifier(identifier);

        // Check if the request is sane
        if (chunkNumber == 0 || chunkSize == 0 || totalSize == 0 || identifier.length == 0 || filename.length == 0) {
            return 'non_flow_request';
        }
        var numberOfChunks = Math.max(Math.floor(totalSize / (chunkSize * 1.0)), 1);
        if (chunkNumber > numberOfChunks) {
            return 'invalid_flow_request1';
        }

        // Is the file too big?
        if ($.maxFileSize && totalSize > $.maxFileSize) {
            return 'invalid_flow_request2';
        }

        if (typeof(fileSize) != 'undefined') {
            if (chunkNumber < numberOfChunks && fileSize != chunkSize) {
                // The chunk in the POST request isn't the correct size
                return 'invalid_flow_request3';
            }
            if (numberOfChunks > 1 && chunkNumber == numberOfChunks && fileSize != ((totalSize % chunkSize) + parseInt(chunkSize))) {
                // The chunks in the POST is the last one, and the fil is not the correct size
                return 'invalid_flow_request4';
            }
            if (numberOfChunks == 1 && fileSize != totalSize) {
                // The file is only a single chunk, and the data size does not fit
                return 'invalid_flow_request5';
            }
        }

        return 'valid';
    }

    //'found', filename, original_filename, identifier
    //'not_found', null, null, null
    $.get = function (req, callback) {
        var chunkNumber = req.param('flowChunkNumber', 0);
        var chunkSize = req.param('flowChunkSize', 0);
        var totalSize = req.param('flowTotalSize', 0);
        var identifier = req.param('flowIdentifier', '');
        var filename = req.param('flowFilename', '');

        var result = validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename);

        console.log('flow.validateRequest() result: %s', result);

        if (result === 'valid') {
            var chunkFilename = getChunkFilename(chunkNumber, identifier);
            console.log('valid chunk received: %s', chunkFilename);

            fs.exists(chunkFilename, function (exists) {
                if (exists) {
                    callback('found', chunkFilename, filename, identifier);
                } else {
                    callback('not_found', null, null, null);
                }
            });
        } else {
            console.log('invalid request');
            callback('not_found', null, null, null);
        }
    };

    //'partly_done', filename, original_filename, identifier
    //'done', filename, original_filename, identifier
    //'invalid_flow_request', null, null, null
    //'non_flow_request', null, null, null
    $.post = function (req, callback) {

        var fields = req.body;
        var files = req.files;

        //console.log('# files: %s', files.size);

        var chunkNumber = fields['flowChunkNumber'];
        var chunkSize = fields['flowChunkSize'];
        var totalSize = fields['flowTotalSize'];
        var identifier = cleanIdentifier(fields['flowIdentifier']);
        var filename = fields['flowFilename'];

        if (!files[$.fileParameterName] || !files[$.fileParameterName].size) {
            callback('invalid_flow_request', null, null, null);
            return;
        }

        var original_filename = files[$.fileParameterName]['originalFilename'];
        var validation = validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, files[$.fileParameterName].size);
        if (validation == 'valid') {
            var chunkFilename = getChunkFilename(chunkNumber, identifier);

            // Save the chunk (TODO: OVERWRITE)
            fs.rename(files[$.fileParameterName].path, chunkFilename, function () {

                // Do we have all the chunks?
                var currentTestChunk = 1;
                var numberOfChunks = Math.max(Math.floor(totalSize / (chunkSize * 1.0)), 1);
                var testChunkExists = function () {
                    fs.exists(getChunkFilename(currentTestChunk, identifier), function (exists) {
                        if (exists) {
                            currentTestChunk++;
                            if (currentTestChunk > numberOfChunks) {
                                // Add currentTestChunk and numberOfChunks to the callback
                                callback('done', filename, original_filename, identifier, currentTestChunk, numberOfChunks);
                            } else {
                                // Recursion
                                testChunkExists();
                            }
                        } else {
                            // Add currentTestChunk and numberOfChunks to the callback
                            callback('partly_done', filename, original_filename, identifier, currentTestChunk, numberOfChunks);
                        }
                    });
                };
                testChunkExists();
            });
        } else {
            callback(validation, filename, original_filename, identifier);
        }
    };

    // Pipe chunks directly in to an existsing WritableStream
    //   r.write(identifier, response);
    //   r.write(identifier, response, {end:false});
    //
    //   var stream = fs.createWriteStream(filename);
    //   r.write(identifier, stream);
    //   stream.on('data', function(data){...});
    //   stream.on('finish', function(){...});
    $.write = function (identifier, writableStream, options) {
        options = options || {};
        options.end = (typeof options['end'] == 'undefined' ? true : options['end']);

        console.log('flow.write() identifier: %s', identifier);

        // Iterate over each chunk
        var pipeChunk = function (number) {

            var chunkFilename = getChunkFilename(number, identifier);
            fs.exists(chunkFilename, function (exists) {

                if (exists) {
                    // If the chunk with the current number exists,
                    // then create a ReadStream from the file
                    // and pipe it to the specified writableStream.
                    var sourceStream = fs.createReadStream(chunkFilename);
                    sourceStream.pipe(writableStream, {
                        end: false
                    });
                    sourceStream.on('end', function () {
                        // When the chunk is fully streamed,
                        // jump to the next one
                        pipeChunk(number + 1);
                    });
                } else {
                    // When all the chunks have been piped, end the stream
                    if (options.end) {
                        writableStream.end();
                    }
                    if (options.onDone) {
                        options.onDone(identifier);
                    }
                }
            });
        };
        pipeChunk(1);
    };

    $.clean = function (identifier, options) {
        options = options || {};

        console.log('flow.clean() identifier: %s', identifier);

        // Iterate over each chunk
        var pipeChunkRm = function (number) {

            var chunkFilename = getChunkFilename(number, identifier);

            //console.log('removing pipeChunkRm ', number, 'chunkFilename', chunkFilename);
            fs.exists(chunkFilename, function (exists) {
                if (exists) {

                    console.log('exist removing ', chunkFilename);
                    fs.unlink(chunkFilename, function (err) {
                        if (err && options.onError) options.onError(err);
                    });

                    pipeChunkRm(number + 1);

                } else {

                    if (options.onDone) {
                        options.onDone(identifier);
                    }

                }
            });
        };
        pipeChunkRm(1);
    };

    return $;
};
