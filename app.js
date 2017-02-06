// All of our requires for our outside modules
var url = require('url');
var express = require('express');
var bodyParser = require('body-parser');
var queryString = require('querystring');
var async = require('async');
var mongoClient = require('mongodb').MongoClient;


// Require our seperate modules
var authenticator = require('./authenticator.js');
var storage = require('./storage.js');
var config = require('./config.json');

// Set up express app
var app = express();

// Connect to our MongoDB database
storage.connect();

// Set up template engine to use EJS
app.set('view engine', 'ejs');

// Add cookie parser functionality to our app
app.use(require('cookie-parser')());

// Parse JSON body and store resluts in the req.body
app.use(bodyParser.json());

// Static Files go to public
app.use(express.static('./public'));

// Clear MongoDB cache in time intervals
setInterval(function () {
    console.log('Clearing MongoDB cache...');
    if (storage.connected()) {
        storage.deleteFriends();
    }
}, 1000 * 60 * 5);

// A function to ensure the user is logged in
function ensureLoggedIn(req, res, next) {
    if (!req.cookies.access_token || !req.cookies.access_token_secret || !req.cookies.twitter_id) {
        return res.sendStatus(401);
    }
    next();
}

/*
    All of our routes
*/

app.get('/', function(req, res) {
    if (!req.cookies.access_token || !req.cookies.access_token_secret || !req.cookies.twitter_id) {
        return res.redirect('/login');
    }
    if (!storage.connected()) {
        console.log('Loading data from Twitter...');
        return renderMainPageFromTwitter(req, res);
    }
    // Get our data from MongoDB
    console.log('Loading data from MongoDB...');

    storage.getFriends(req.cookies.twitter_id, function (err, friends) {
        if (err) {
            return res.status(500).send(err);
        }
        if (friends.length > 0) {
            console.log('Data loaded from MongoDB...');

            // Sort the friends alphabetically by name
            friends.sort(function (a, b) {
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });

            // Render index.ejs
            res.render('index', {
                friends: friends
            });
        }
        else {
            console.log('Data Loaded from Twitter...');
            return renderMainPageFromTwitter(req, res);
        }
    });
});

// Get the notes for a friend
app.get('/friends/:uid/notes', ensureLoggedIn, function (req, res, next) {
    storage.getNotes(req.cookies.twitter_id, req.params.uid, function (err, notes) {
        if (err) {
            return res.status(500).send(err);
        }
        res.send(notes);
    });
});

// Add a new note to a friend
app.post('/friends/:uid/notes', ensureLoggedIn, function (req, res, next) {
    storage.insertNote(req.cookies.twitter_id, req.params.uid, req.body.content, function (err, note) {
        if (err) {
            return res.status(500).send(err);
        }
        res.send(note);
    });
});

app.put('/friends/:uid/notes/:noteid', ensureLoggedIn, function (req, res, next) {
    var noteId = req.params.noteid;

    storage.updateNote(noteId, req.cookies.twitter_id, req.body.content, function (err, note) {
        if (err) {
            return res.status(500).send(err);
        }
        res.send({
            _id: note._id,
            content: note.content
        });
    });
});

app.delete('/friends/:uid/notes/:noteid', ensureLoggedIn, function (req, res) {
    var noteId = req.params.noteid;
    storage.deleteNote(noteId, req.cookies.twitter_id, function (err) {
        if (err) {
            return res.status(500).send(err);
        }
        res.sendStatus(200);
    });
});

// This is handeled by our authenticator.js
app.get('/auth/twitter', authenticator.redirectToTwitterLogin);

app.get(url.parse(config.oauth_callback).path, function(req, res) {
    authenticator.authenticate(req, res, function(err) {
        if (err) {
            res.redirect('/login');
        } else {
            res.redirect('/');
        }
    });
});

app.get('/tweet', function(req, res) {
    if (!req.cookies.access_token || !req.cookies.access_token_secret) {
        return res.sendStatus(401);
    }

    authenticator.post('https://api.twitter.com/1.1/statuses/update.json', req.cookies.access_token, req.cookies.access_token_secret, {
        status: 'This tweet was made using Node.JS 123456'
    }, function(error, data) {
        if (error) {
            return res.status(400).send(error);
        }
        res.send('Tweet Successful!');
    });
});

app.get('/search', function(req, res) {
    if (!req.cookies.access_token || !req.cookies.access_token_secret) {
        return res.sendStatus(401);
    }

    authenticator.get('https://api.twitter.com/1.1/search/tweets.json?' + queryString.stringify({q:'Trump'}), req.cookies.access_token, req.cookies.access_token_secret, function(error, data) {
        if (error) {
            return res.status(400).send(error);
        }
        res.send(data);
    });
});

app.get('/friends', function (req, res) {
    if (!req.cookies.access_token || !req.cookies.access_token_secret) {
        return res.sendStatus(401);
    }

    var url = 'https://api.twitter.com/1.1/friends/list.json';

    if (req.query.cursor) {
        url += '?' + queryString.stringify({cursor : req.query.cursor});
    }

    authenticator.get(url, req.cookies.access_token, req.cookies.access_token_secret, function(error, data) {
        if (error) {
            return res.status(400).send(error);
        }
        res.send(data);
    });
});

function renderMainPageFromTwitter(req, res) {
    async.waterfall([
        // Get Twitter friends and ID's
        function (cb) {
            var cursor = -1;

            var ids = [];

            console.log('1) IDs array length: ' + ids.length);

            async.whilst(
                function () {
                    return cursor != 0;
                },
                function (cb) {
                    authenticator.get('https://api.twitter.com/1.1/friends/ids.json?' + queryString.stringify({
                        user_id : req.cookies.twitter_id,
                        cursor : cursor
                    }), req.cookies.access_token, req.cookies.access_token_secret, function (error, data) {
                        if (error) {
                            return res.status(400).send(error);
                        }
                        data = JSON.parse(data);

                        cursor = data.next_cursor_str;

                        ids = ids.concat(data.ids);

                        cb();
                    });
                },
                function (error) {
                    if (error) {
                        return res.status(500).send(error);
                    }
                    cb(null, ids);
                }
            );
        },

        // Get Twitter friends data using ID's
        function (ids, cb) {
            // Returns 100 IDs start from 100 + 1
            var getHundredthIds = function (i) {
                return ids.slice(100*i, Math.min(ids.length, 100*(i+1)));
            };
            var requestsNeeded = Math.ceil(ids.length/100);

            async.times(requestsNeeded, function (n, next) {
                var url = 'https://api.twitter.com/1.1/users/lookup.json?' + queryString.stringify({
                    user_id : getHundredthIds(n).join(' , ')
                });

                authenticator.get(url, req.cookies.access_token, req.cookies.access_token_secret, function (error, data) {
                    if (error) {
                        return res.status(400).send(error);
                    }
                    var friends = JSON.parse(data);
                    next(null, friends);
                });
            },
            function (err, friends) {
                // Flaten friends array
                friends = friends.reduce(function (previousValue, currentValue, currentIndex, array) {
                    return previousValue.concat(currentValue);
                }, []);

                // Sort the friends alphabetically by name
                friends.sort(function (a, b) {
                    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                });

                // Transform friends array into format good for our app in other words shrinking the array and taking out the stuff we arent using
                friends = friends.map(function (friend) {
                    return {
                        twitter_id: friend.id_str,
                        for_user: req.cookies.twitter_id,
                        name: friend.name,
                        screen_name: friend.screen_name,
                        location: friend.location,
                        profile_image_url: friend.profile_image_url
                    };
                });

                res.render('index', {
                    friends: friends
                });

                // Asynchronously we get that fresh data from twitter we are going to store the data in MongoDB
                if (storage.connected) {
                    storage.insertFriends(friends);
                }

                console.log('ids.length: ' + ids.length);
            });
        }
    ]);
}

app.get('/login', function (req, res) {
    console.log('Deleting the friends collection on login');
    if (storage.connected()) {
        storage.deleteFriends();
    }

    res.render('login');
});

app.get('/logout', function (req, res) {
    // Clear the cookies
    res.clearCookie('access_token');
    res.clearCookie('access_token_secret');
    res.clearCookie('twitter_id');

    console.log('Deleting the friends collection on login');
    if (storage.connected()) {
        storage.deleteFriends();
    }

    // Take them back to the login page
    res.redirect('/login');
});

app.listen(config.port, function() {
    console.log("Server running on port " + config.port);

    console.log('OAuth callback: ' + url.parse(config.oauth_callback).hostname + url.parse(config.oauth_callback).path);
});
