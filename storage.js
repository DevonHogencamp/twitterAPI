var mongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var database;

module.exports = {
    connect: function () {
        mongoClient.connect('mongodb://localhost:27017/twitter_notes', function (err, db) {
            if (err) {
                return console.log('Error: ' + err);
            }

            database = db;

            console.log('Connected to database!');
        });
    },
    connected: function () {
        console.log('Type of database is ' + (typeof database));
        return typeof database != 'undefined';
    },
    insertFriends: function (friends) {
        database.collection('friends').insert(friends, function (err) {
            if (err) {
                console.log('Could not insert friends in the database');
            }
        });
    },
    getFriends: function (userid, cb) {
        var cursor = database.collection('friends').find({
            for_user: userid
        });

        cursor.toArray(cb);
    },
    deleteFriends: function () {
        database.collection('friends').remove({}, function (err) {
            if (err) {
                console.log('Could not delete friends in the database');
            }
        });
    },
    getNotes: function (ownerId, friendId, cb) {
        var cursor = database.collection('notes').find({
            ownerId: ownerId,
            friendId: friendId,
        });

        cursor.toArray(function (err, notes) {
            if (err) {
                return cb(err);
            }
            cb(null, notes.map(function (note) {
                return {
                    _id: note._id,
                    content: note.content
                };
            }));
        });
    },
    insertNote: function (ownerId, friendId, content, cb) {
        database.collection('notes').insert({
            ownerId: ownerId,
            friendId: friendId,
            content: content
        }, function (err, result) {
            if (err) {
                return cb(err, result);
            }
            cb(null, {
                _id: result.ops[0]._id,
                content: result.ops[0].content
            });
        });
    },
    updateNote: function (noteId, ownerId, content, cb) {
        database.collection('notes').updateOne({
            _id: new ObjectID(noteId),
            ownerId: ownerId
        }, {
            $set: { content: content }
        }, function (err, result) {
            if (err) {
                return cb(err);
            }
            database.collection('notes').findOne({
                _id: new ObjectID(noteId),
            });
        }, cb);
    },
    deleteNote: function (noteId, ownerId, cb) {
        database.collection('notes').deleteOne({
            _id: new ObjectID(noteId),
            ownerId: ownerId
        }, cb);
    }
};
