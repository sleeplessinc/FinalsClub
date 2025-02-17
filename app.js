// FinalsClub Server
// 
// This file consists of the main webserver for FinalsClub.org
// and is split between a standard CRUD style webserver and
// a websocket based realtime webserver.
//
// A note on house keeping: Anything with XXX is marked
// as such because it should be looked at and possibly
// revamped or removed depending on circumstances.

// Module loading
var sys					= require( 'sys' );
var os					= require( 'os' );
var url					= require( 'url' );
var express			= require( 'express' );
var mongoStore	= require( 'connect-mongo' );
var async				= require( 'async' );
var db					= require( './db.js' );
var mongoose		= require( './models.js' ).mongoose;
var Mailer			= require( './mailer.js' );
var hat					= require('hat');
var connect			= require( 'connect' );
var Session			= connect.middleware.session.Session;
var parseCookie = connect.utils.parseCookie;

// Depracated
// Used for initial testing
var log3 = function() {}

// Create webserver
var app = module.exports = express.createServer();

// Load Mongoose Schemas
// The actual schemas are located in models.j
var User		= mongoose.model( 'User' );
var School	= mongoose.model( 'School' );
var Course	= mongoose.model( 'Course' );
var Lecture	= mongoose.model( 'Lecture' );
var Note		= mongoose.model( 'Note' );

// More schemas used for legacy data
var ArchivedCourse = mongoose.model( 'ArchivedCourse' );
var ArchivedNote = mongoose.model( 'ArchivedNote' );
var ArchivedSubject = mongoose.model( 'ArchivedSubject' );

// XXX Not sure if necessary
var ObjectId	= mongoose.SchemaTypes.ObjectId;

// Configuration
// Use the environment variable DEV_EMAIL for testing
var ADMIN_EMAIL = process.env.DEV_EMAIL || 'info@finalsclub.org';

// Set server hostname and port from environment variables,
// then check if set.
// XXX Can be cleaned up
var serverHost = process.env.SERVER_HOST;
var serverPort = process.env.SERVER_PORT;

if( serverHost ) {
  console.log( 'Using server hostname defined in environment: %s', serverHost );
} else {
  serverHost = os.hostname();
  console.log( 'No hostname defined, defaulting to os.hostname(): %s', serverHost );
}

// Express configuration depending on environment
// development is intended for developing locally or
// when not in production, otherwise production is used
// when the site will be run live for regular usage.
app.configure( 'development', function() { 
  // In development mode, all errors and stack traces will be
  // dumped to the console and on page for easier troubleshooting
  // and debugging.
  app.set( 'errorHandler', express.errorHandler( { dumpExceptions: true, showStack: true } ) );

  // Set database connection information from environment
  // variables otherwise use localhost.
  app.set( 'dbHost', process.env.MONGO_HOST || 'localhost' );
  app.set( 'dbUri', 'mongodb://' + app.set( 'dbHost' ) + '/fc' );

  // Set Amazon access and secret keys from environment
  // variables. These keys are intended to be secret, so
  // are not included in the source code, but set on the server
  // manually.
  app.set( 'awsAccessKey', process.env.AWS_ACCESS_KEY_ID );
  app.set( 'awsSecretKey', process.env.AWS_SECRET_ACCESS_KEY );

  // If a port wasn't set earlier, set to 3000
  if ( !serverPort ) {
    serverPort = 3000;
  }	 
});

// Production configuration settings
app.configure( 'production', function() {
  // At the moment we have errors outputting everything
  // so if there are any issues it is easier to track down.
  // Once the site is more stable it will be prudent to 
  // use less error tracing.
  app.set( 'errorHandler', express.errorHandler( { dumpExceptions: true, showStack: true } ) );

  // Disable view cache due to stale views.
  // XXX Disable view caching temp
  app.disable( 'view cache' )

  // Against setting the database connection information
  // XXX Can be cleaned up or combined
  app.set( 'dbHost', process.env.MONGO_HOST || 'localhost' );
  app.set( 'dbUri', 'mongodb://' + app.set( 'dbHost' ) + '/fc' );

  // XXX Can be cleaned up or combined
  app.set( 'awsAccessKey', process.env.AWS_ACCESS_KEY_ID );
  app.set( 'awsSecretKey', process.env.AWS_SECRET_ACCESS_KEY );

  // Set to port 80 if not set through environment variables
  if ( !serverPort ) {
    serverPort = 80;
  }	
});

// General Express configuration settings
app.configure(function(){
  // Views are housed in the views folder
  app.set( 'views', __dirname + '/views' );
  // All templates use jade for rendering
  app.set( 'view engine', 'jade' );
  // Bodyparser is required to handle form submissions
  // without manually parsing them.
  app.use( express.bodyParser() );

  app.use( express.cookieParser() );

  // Sessions are stored in mongodb which allows them
  // to be persisted even between server restarts.
  app.set( 'sessionStore', new mongoStore( {
    'url' : app.set( 'dbUri' )
  }));

  // This is where the actual Express session handler
  // is defined, with a mongoStore being set as the
  // session storage versus in memory storage that is
  // used by default.
  app.use( express.session( {
    // A secret 'password' for encrypting and decrypting
    // cookies.
    // XXX Should be handled differently
    'secret'	: 'finalsclub',
    // The max age of the cookies that is allowed
    // 60 (seconds) * 60 (minutes) * 24 (hours) * 30 (days) * 1000 (milliseconds)
    'maxAge'	: new Date(Date.now() + (60 * 60 * 24 * 30 * 1000)),
    'store'		: app.set( 'sessionStore' )
  }));

  // methodOverride is used to handle PUT and DELETE HTTP
  // requests that otherwise aren't handled by default.
  app.use( express.methodOverride() );
  // Sets the routers middleware to load after everything set
  // before it, but before static files.
  app.use( app.router );
  // Static files are loaded when no dynamic views match.
  app.use( express.static( __dirname + '/public' ) );

  // This is the errorHandler set in configuration earlier
  // being set to a variable to be used after all other
  // middleware is loaded. Error handling should always
  // come last or near the bottom.
  var errorHandler = app.set( 'errorHandler' );

  app.use( errorHandler );
});


// Mailer functions and helpers
// These are helper functions that make for cleaner code.

// sendUserActivation is for when a user registers and
// first needs to activate their account to use it.
function sendUserActivation( user ) {
  var message = {
    'to'				: user.email,

    'subject'		: 'Activate your FinalsClub.org Account',

    // Templates are in the email folder and use ejs
    'template'	: 'userActivation',
    // Locals are used inside ejs so dynamic information
    // can be rendered properly.
    'locals'		: {
      'user'				: user,
      'serverHost'	: serverHost
    }
  };

  // Email is sent here
  mailer.send( message, function( err, result ) {
    if( err ) {
      // XXX: Add route to resend this email
      console.log( 'Error sending user activation email\nError Message: '+err.Message );
    } else {
      console.log( 'Successfully sent user activation email.' );
    }
  });
}

// sendUserWelcome is for when a user registers and
// a welcome email is sent.
function sendUserWelcome( user, school ) {
  // If a user is not apart of a supported school, they are
  // sent a different template than if they are apart of a
  // supported school.
  var template = school ? 'userWelcome' : 'userWelcomeNoSchool';
  var message = {
    'to'				: user.email,

    'subject'		: 'Welcome to FinalsClub',

    'template'	: template,
    'locals'		: {
      'user'				: user,
      'serverHost'	: serverHost
    }
  };

  mailer.send( message, function( err, result ) {
    if( err ) {
      // XXX: Add route to resend this email
      console.log( 'Error sending user welcome email\nError Message: '+err.Message );
    } else {
      console.log( 'Successfully sent user welcome email.' );
    }
  });
}

// Helper middleware
// These functions are used later in the routes to help
// load information and variables, as well as handle
// various instances like checking if a user is logged in
// or not.
function loggedIn( req, res, next ) {
  // If req.user is set, then pass on to the next function
  // or else alert the user with an error message.
  if( req.user ) {
    next();
  } else {
    req.flash( 'error', 'You must be logged in to access that feature!' );
    res.redirect( '/' );
  }
}

// This loads the user if logged in
function loadUser( req, res, next ) {
  var sid = req.sessionID;

  console.log( 'got request from session ID: %s', sid );

  // Find a user based on their stored session id
  User.findOne( { session : sid }, function( err, user ) {

    log3(err);
    log3(user);

    // If a user is found then set req.user the contents of user
    // and make sure req.user.loggedIn is true.
    if( user ) {
      req.user = user;

      req.user.loggedIn = true;

      log3( 'authenticated user: '+req.user._id+' / '+req.user.email+'');

      // Check if a user is activated. If not, then redirec
      // to the homepage and tell them to check their email
      // for the activation email.
      if( req.user.activated ) {
        // Is the user's profile complete? If not, redirect to their profile
        if( ! req.user.isComplete ) {
          if( url.parse( req.url ).pathname != '/profile' ) {
            req.flash( 'info', 'Your profile is incomplete. Please complete your profile to fully activate your account.' );

            res.redirect( '/profile' );
          } else {
            next();
          }
        } else {
          next();
        }
      } else {
        req.flash( 'info', 'This account has not been activated. Check your email for the activation URL.' );

        res.redirect( '/' );
      }
    } else {
      // If no user record was found, then we store the requested
      // path they intended to view and redirect them after they
      // login if it is requred.
      var path = url.parse( req.url ).pathname;
      req.session.redirect = path;

      // Set req.user to an empty object so it doesn't throw errors
      // later on that it isn't defined.
      req.user = {};

      next();
    }
  });
}

// loadSchool is used to load a school by it's id
function loadSchool( req, res, next ) {
  var user			= req.user;
  var schoolId	= req.params.id;

  School.findById( schoolId, function( err, school ) {
    if( school ) {
      req.school = school;

      // If a school is found, the user is checked to see if they are
      // authorized to see or interact with anything related to that
      // school.
      school.authorize( user, function( authorized ){
        req.school.authorized = authorized;
        next();
      });
    } else {
      // If no school is found, display an appropriate error.
      req.flash( 'error', 'Invalid school specified!' );

      res.redirect( '/' );
    }
  });
}

// loadSchool is used to load a course by it's id
function loadCourse( req, res, next ) {
  var user			= req.user;
  var courseId	= req.params.id;

  Course.findById( courseId, function( err, course ) {
    if( course && !course.deleted ) {
      req.course = course;

      // If a course is found, the user is checked to see if they are
      // authorized to see or interact with anything related to that
      // school.
      course.authorize( user, function( authorized )  {
        req.course.authorized = authorized;

        next();
      });
    } else {
      // If no course is found, display an appropriate error.
      req.flash( 'error', 'Invalid course specified!' );

      res.redirect( '/' );
    }
  });
}

// loadLecture is used to load a lecture by it's id
function loadLecture( req, res, next ) {
  var user			= req.user;
  var lectureId	= req.params.id;

  Lecture.findById( lectureId, function( err, lecture ) {
    if( lecture && !lecture.deleted ) {
      req.lecture = lecture;

      // If a lecture is found, the user is checked to see if they are
      // authorized to see or interact with anything related to that
      // school.
      lecture.authorize( user, function( authorized ) {
        req.lecture.authorized = authorized;

        next();
      });
    } else {
      // If no lecture is found, display an appropriate error.
      req.flash( 'error', 'Invalid lecture specified!' );

      res.redirect( '/' );
    }
  });
}

// loadNote is used to load a note by it's id
// This is a lot more complicated than the above
// due to public/private handling of notes.
function loadNote( req, res, next ) {
  var user	 = req.user ? req.user : false;
  var noteId = req.params.id;

  Note.findById( noteId, function( err, note ) {
    // If a note is found, and user is set, check if
    // user is authorized to interact with that note.
    if( note && user && !note.deleted ) {
      note.authorize( user, function( auth ) {
        if( auth ) {
          // If authorzied, then set req.note to be used later
          req.note = note;

          next();
        } else if ( note.public ) {
          // If not authorized, but the note is public, then
          // designate the note read only (RO) and store req.note
          req.RO = true;
          req.note = note;

          next();
        } else {
          // If the user is not authorized and the note is private
          // then display and error.
          req.flash( 'error', 'You do not have permission to access that note.' );

          res.redirect( '/' );
        }
      })
    } else if ( note && note.public && !note.deleted ) {
      // If note is found, but user is not set because they are not
      // logged in, and the note is public, set the note to read only
      // and store the note for later.
      req.note = note;
      req.RO = true;

      next();
    } else if ( note && !note.public && !note.deleted ) {
      // If the note is found, but user is not logged in and the note is
      // not public, then ask them to login to view the note. Once logged
      // in they will be redirected to the note, at which time authorization
      // handling will be put in effect above.
      req.session.redirect = '/note/' + note._id;
      req.flash( 'error', 'You must be logged in to view that note.' );
      res.redirect( '/login' );
    } else {
      // No note was found
      req.flash( 'error', 'Invalid note specified!' );

      res.redirect( '/schools' );
    }
  });
}

// Dynamic Helpers are loaded automatically into views
app.dynamicHelpers( {
  // express-messages is for flash messages for easy
  // errors and information display
  'messages' : require( 'express-messages' ),

  // By default the req object isn't sen't to views
  // during rendering, this allows you to use the
  // user object if available in views.
  'user' : function( req, res ) {
    return req.user;
  },

  // Same, this allows session to be available in views.
  'session' : function( req, res ) {
    return req.session;
  }
});

// Routes
// The following are the main CRUD routes that are used
// to make up this web app.

// Homepage
// Public
app.get( '/', loadUser, function( req, res ) {
  log3("get / page");

  res.render( 'index' );
});

// Schools list
// Used to display all available schools and any courses
// in those schools.
// Public with some private information
app.get( '/schools', loadUser, function( req, res ) {
  var user = req.user;

  // Find all schools and sort by name
  // XXX mongoose's documentation on sort is extremely poor, tread carefully
  School.find( {} ).sort( 'name', '1' ).run( function( err, schools ) {
    if( schools ) {
      // If schools are found, loop through them gathering any courses that are
      // associated with them and then render the page with that information.
      async.forEach(
        schools,
        function( school, callback ) {
          // Check if user is authorized with each school
          school.authorize( user, function( authorized ) {
            // This is used to display interface elements for those users
            // that are are allowed to see them, for instance a 'New Course' button.
            school.authorized = authorized;

            // Find all courses for school by it's id and sort by name
            Course.find( { 'school' : school._id } ).sort( 'name', '1' ).run( function( err, courses ) {
              // If any courses are found, set them to the appropriate school, otherwise
              // leave empty.
              if( courses.length > 0 ) {
                school.courses = courses.filter(function(course) {
                  if (!course.deleted) return course;
                });
              } else {
                school.courses = [];
              }
              // This tells async (the module) that each iteration of forEach is
              // done and will continue to call the rest until they have all been
              // completed, at which time the last function below will be called.
              callback();
            });
          });
        },
        // After all schools and courses have been found, render them
        function( err ) {
          res.render( 'schools', { 'schools' : schools } );
        }
      );
    } else {
      // If no schools have been found, display none
      res.render( 'schools', { 'schools' : [] } );
    }
  });
});

// New course page
// Displays form to create new course
// Private, requires user to be authorized
app.get( '/:id/course/new', loadUser, loadSchool, function( req, res ) {
  // Load school from middleware
  var school = req.school;

  // If school was not loaded for whatever reason, or the user is not authorized
  // then redirect to the main schools page.
  if( ( ! school ) || ( ! school.authorized ) ) {
    return res.redirect( '/schools' );
  }

  // If they are authorized and the school exists, then render the page
  res.render( 'course/new', { 'school': school } );
});

// Recieves new course form
app.post( '/:id/course/new', loadUser, loadSchool, function( req, res ) {
  var school = req.school;
  // Creates new course from Course Schema
  var course = new Course;
  // Gathers instructor information from form
  var instructorEmail = req.body.email.toLowerCase();
  var instructorName = req.body.instructorName;

  // If school doesn't exist or user is not authorized redirect to main schools page
  if( ( ! school ) || ( ! school.authorized ) ) {
    res.redirect( '/schools' );
  }

  // If instructorEmail isn't set, or name isn't set, display error and re-render the page.
  if ( !instructorEmail || !instructorName ) {
    req.flash( 'error', 'Invalid parameters!' )
    return res.render( 'course/new' );
  }

  // Fill out the course with information from the form
  course.number				= req.body.number;
  course.name					= req.body.name;
  course.description	= req.body.description;
  course.school				= school._id;
  course.creator      = req.user._id;
  course.subject      = req.body.subject;
  course.department   = req.body.department;

  // Check if a user exists with the instructorEmail, if not then create
  // a new user and send them an instructor welcome email.
  User.findOne( { 'email' : instructorEmail }, function( err, user ) {
    if ( !user ) {
      var user          = new User;

      user.name					= instructorName
      user.email        = instructorEmail;
      user.affil        = 'Instructor';
      user.school       = school.name;

      user.activated    = false;

      // Validate instructorEmail
      // XXX Probably could be done before checking db
      if ( ( user.email === '' ) || ( !isValidEmail( user.email ) ) ) {
        req.flash( 'error', 'Please enter a valid email' );
        // XXX This needs to be fixed, this is not the proper flow
        return res.redirect( '/register' );
      }
      // Once the new user information has been completed, save the user
      // to the database then email them the instructor welcome email.
      user.save(function( err ) {
        // If there was an error saving the instructor, prompt the user to fill out
        // the information again.
        if ( err ) {
          req.flash( 'error', 'Invalid parameters!' )
          return res.render( 'course/new' );
        } else {
          var message = {
            to					: user.email,

            'subject'		: 'A non-profit open education initiative',

            'template'	: 'instructorInvite',
            'locals'		: {
              'course'			: course,
              'school'			: school,
              'user'				: user,
              'serverHost'	: serverHost
            }
          };

          mailer.send( message, function( err, result ) {
            if( err ) {
              console.log( 'Error inviting instructor to course!' );
            } else {
              console.log( 'Successfully invited instructor to course.' );
            }
          });

          // After emails are sent, set the courses instructor to the
          // new users id and then save the course to the database.
          course.instructor = user._id;
          course.save( function( err ) {
            if( err ) {
              // XXX better validation
              req.flash( 'error', 'Invalid parameters!' );

              return res.render( 'course/new' );
            } else {
              // Once the course has been completed email the admin with information
              // on the course and new instructor
              var message = {
                to					: ADMIN_EMAIL,

                'subject'		: school.name+' has a new course: '+course.name,

                'template'	: 'newCourse',
                'locals'		: {
                  'course'			: course,
                  'instructor'  : user,
                  'user'				: req.user,
                  'serverHost'	: serverHost
                }
              };

              mailer.send( message, function( err, result ) {
                if ( err ) {
                  console.log( 'Error sending new course email to info@finalsclub.org' )
                } else {
                  console.log( 'Successfully invited instructor to course')
                }
              })
              // Redirect the user to the schools page where they can see
              // their new course.
              // XXX Redirect to the new course instead
              res.redirect( '/schools' );
            }
          });
        }
      })
    } else {
      // If the user exists, then check if they are already and instructor
      if (user.affil === 'Instructor') {
        // If they are an instructor, then save the course with the appropriate
        // information and email the admin.
        course.instructor = user._id;
        course.save( function( err ) {
          if( err ) {
            // XXX better validation
            req.flash( 'error', 'Invalid parameters!' );

            return res.render( 'course/new' );
          } else {
            var message = {
              to					: ADMIN_EMAIL,

              'subject'		: school.name+' has a new course: '+course.name,

              'template'	: 'newCourse',
              'locals'		: {
                'course'			: course,
                'instructor'  : user,
                'user'				: req.user,
                'serverHost'	: serverHost
              }
            };

            mailer.send( message, function( err, result ) {
              if ( err ) {
                console.log( 'Error sending new course email to info@finalsclub.org' )
              } else {
                console.log( 'Successfully invited instructor to course')
              }
            })
            // XXX Redirect to the new course instead
            res.redirect( '/schools' );
          }
        });
      } else {
        // The existing user isn't an instructor, so the user is notified of the error
        // and the course isn't created.
        req.flash( 'error', 'The existing user\'s email you entered is not an instructor' );
        res.render( 'course/new' );
      }
    }
  })
});

// Individual Course Listing
// Public with private information
app.get( '/course/:id', loadUser, loadCourse, function( req, res ) {
  var userId = req.user._id;
  var course = req.course;

  // Check if the user is subscribed to the course
  // XXX Not currently used for anything
  var subscribed = course.subscribed( userId );

  // Find lectures associated with this course and sort by name
  Lecture.find( { 'course' : course._id } ).sort( 'name', '1' ).run( function( err, lectures ) {
    // Get course instructor information using their id
    User.findById( course.instructor, function( err, instructor ) {
      // Render course and lectures
      res.render( 'course/index', { 'course' : course, 'instructor': instructor, 'subscribed' : subscribed, 'lectures' : lectures } );
    })
  });
});

// Edit Course
app.get( '/course/:id/edit', loadUser, loadCourse, function( req, res) {
  var course = req.course;
  var user = req.user;

  if ( user.admin ) {
    res.render( 'course/new', {course: course} )
  } else {
    req.flash( 'error', 'You don\'t have permission to do that' )
    res.redirect( '/schools' );
  }
})

// Recieve Course Edit Form
app.post( '/course/:id/edit', loadUser, loadCourse, function( req, res ) {
  var course = req.course;
  var user = req.user;

  if (user.admin) {
    var courseChanges = req.body;
    course.number = courseChanges.number;
    course.name = courseChanges.name;
    course.description = courseChanges.description;
    course.department = courseChanges.department;

    course.save(function(err) {
      if (err) {
        req.flash( 'error', 'There was an error saving the course' );
      }
      res.redirect( '/course/'+ course._id.toString());
    })
  } else {
    req.flash( 'error', 'You don\'t have permission to do that' )
    res.redirect( '/schools' );
  }
});

// Delete Course
app.get( '/course/:id/delete', loadUser, loadCourse, function( req, res) {
  var course = req.course;
  var user = req.user;

  if ( user.admin ) {
    course.delete(function( err ) {
      if ( err ) req.flash( 'info', 'There was a problem removing course: ' + err )
      else req.flash( 'info', 'Successfully removed course' )
      res.redirect( '/schools' );
    });
  } else {
    req.flash( 'error', 'You don\'t have permission to do that' )
    res.redirect( '/schools' );
  }
})

// Subscribe to course
// XXX Not currently used for anything
app.get( '/course/:id/subscribe', loadUser, loadCourse, function( req, res ) {
  var course = req.course;
  var userId = req.user._id;

  course.subscribe( userId, function( err ) {
    if( err ) {
      req.flash( 'error', 'Error subscribing to course!' );
    }

    res.redirect( '/course/' + course._id );
  });
});

// Unsubscribe from course
// XXX Not currently used for anything
app.get( '/course/:id/unsubscribe', loadUser, loadCourse, function( req, res ) {
  var course = req.course;
  var userId = req.user._id;

  course.unsubscribe( userId, function( err ) {
    if( err ) {
      req.flash( 'error', 'Error unsubscribing from course!' );
    }

    res.redirect( '/course/' + course._id );
  });
});

// Create new lecture
app.get( '/course/:id/lecture/new', loadUser, loadCourse, function( req, res ) {
  var courseId	= req.params.id;
  var course		= req.course;
  var lecture		= {};

  // If course isn't valid or user isn't authorized for course, redirect
  if( ( ! course ) || ( ! course.authorized ) ) {
    return res.redirect( '/course/' + courseId );
  }

  // Render new lecture form
  res.render( 'lecture/new', { 'lecture' : lecture } );
});

// Recieve New Lecture Form
app.post( '/course/:id/lecture/new', loadUser, loadCourse, function( req, res ) {
  var courseId	= req.params.id;
  var course		= req.course;
  // Create new lecture from Lecture schema
  var lecture		= new Lecture;

  if( ( ! course ) || ( ! course.authorized ) ) {
    res.redirect( '/course/' + courseId );

    return;
  }

  // Populate lecture with form data
  lecture.name		= req.body.name;
  lecture.date		= req.body.date;
  lecture.course	= course._id;
  lecture.creator = req.user._id;

  // Save lecture to database
  lecture.save( function( err ) {
    if( err ) {
      // XXX better validation
      req.flash( 'error', 'Invalid parameters!' );

      res.render( 'lecture/new', { 'lecture' : lecture } );
    } else {
      // XXX Redirect to new lecture instead
      res.redirect( '/course/' + course._id );
    }
  });
});


// Display individual lecture and related notes
app.get( '/lecture/:id', loadUser, loadLecture, function( req, res ) {
  var lecture	= req.lecture;

  // Grab the associated course
  // XXX this should be done with DBRefs eventually
  Course.findById( lecture.course, function( err, course ) {
    if( course ) {
      // If course is found, find instructor information to be displayed on page
      User.findById( course.instructor, function( err, instructor ) {
        // Pull out our notes
        Note.find( { 'lecture' : lecture._id } ).sort( 'name', '1' ).run( function( err, notes ) {
          if ( !req.user.loggedIn || !req.lecture.authorized ) {
            // Loop through notes and only return those that are public if the
            // user is not logged in or not authorized for that lecture
            notes = notes.filter(function( note ) {
              if ( note.public ) return note;
            })
          }
          // Render lecture and notes
          res.render( 'lecture/index', {
            'lecture'			: lecture,
            'course'			: course,
            'instructor'  : instructor,
            'notes'				: notes,
            'counts'			: counts,

            'javascripts'	: [ 'counts.js' ]
          });
        });
      })
    } else {
      // XXX with DBRefs we will be able to reassign orphaned courses/lecture/pads

      req.flash( 'error', 'That lecture is orphaned!' );

      res.redirect( '/' );
    }
  });
});

// Display new note form
app.get( '/lecture/:id/notes/new', loadUser, loadLecture, function( req, res ) {
  var lectureId	= req.params.id;
  var lecture		= req.lecture;
  var note			= {};

  if( ( ! lecture ) || ( ! lecture.authorized ) ) {
    res.redirect( '/lecture/' + lectureId );

    return;
  }

  res.render( 'notes/new', { 'note' : note } );
});

// Recieve new note form
app.post( '/lecture/:id/notes/new', loadUser, loadLecture, function( req, res ) {
  var lectureId	= req.params.id;
  var lecture		= req.lecture;

  if( ( ! lecture ) || ( ! lecture.authorized ) ) {
    res.redirect( '/lecture/' + lectureId );

    return;
  }

  // Create note from Note schema
  var note		= new Note;

  // Populate note from form data
  note.name			= req.body.name;
  note.date			= req.body.date;
  note.lecture	= lecture._id;
  note.public		= req.body.private ? false : true;
  note.creator  = req.user._id;

  // Save note to database
  note.save( function( err ) {
    if( err ) {
      // XXX better validation
      req.flash( 'error', 'Invalid parameters!' );

      res.render( 'notes/new', { 'note' : note } );
    } else {
      // XXX Redirect to new note instead
      res.redirect( '/lecture/' + lecture._id );
    }
  });
});


// Display individual note page
app.get( '/note/:id', loadUser, loadNote, function( req, res ) {
  var note = req.note;
  // Set read only id for etherpad-lite or false for later check
  var roID = note.roID || false;

  var lectureId = note.lecture;

  // Count the amount of visits, but only once per session
  if ( req.session.visited ) {
    if ( req.session.visited.indexOf( note._id.toString() ) == -1 ) {
      req.session.visited.push( note._id );
      note.addVisit();
    }
  } else {
    req.session.visited = [];
    req.session.visited.push( note._id );
    note.addVisit();
  }

  // If a read only id exists process note
  if (roID) {
    processReq();
  } else {
    // If read only id doesn't, then fetch the read only id from the database and then
    // process note.
    // XXX Soon to be depracated due to a new API in etherpad that makes for a
    // much cleaner solution.
    db.open('mongodb://' + app.set( 'dbHost' ) + '/etherpad/etherpad', function( err, epl ) {
      epl.findOne( { key: 'pad2readonly:' + note._id }, function(err, record) {
        if ( record ) {
          roID = record.value.replace(/"/g, '');
        } else {
          roID = false;
        }
        processReq();
      })
    })
  }

  function processReq() {
    // Find lecture
    Lecture.findById( lectureId, function( err, lecture ) {
      if( ! lecture ) {
        req.flash( 'error', 'That notes page is orphaned!' );

        res.redirect( '/' );
      }
      // Find notes based on lecture id, which will be displayed in a dropdown
      // on the page
      Note.find( { 'lecture' : lecture._id }, function( err, otherNotes ) {
        if( !req.RO ) {
          // User is logged in and sees full notepad

          res.render( 'notes/index', {
            'layout'			: 'noteLayout',
            'host'				: serverHost,
            'note'				: note,
            'lecture'			: lecture,
            'otherNotes'	: otherNotes,
            'RO'					: false,
            'roID'				: roID,
            'stylesheets' : [ 'dropdown.css', 'fc2.css' ],
            'javascripts'	: [ 'dropdown.js', 'counts.js', 'backchannel.js', 'jquery.tmpl.min.js' ]
          });
        } else {
          // User is not logged in and sees notepad that is public
          res.render( 'notes/public', {
            'layout'			: 'noteLayout',
            'host'				: serverHost,
            'note'				: note,
            'otherNotes'	: otherNotes,
            'roID'				: roID,
            'lecture'			: lecture,
            'stylesheets' : [ 'dropdown.css', 'fc2.css' ],
            'javascripts'	: [ 'dropdown.js', 'counts.js', 'backchannel.js', 'jquery.tmpl.min.js' ]
          });
        }
      });
    });
  }
});

// Static pages and redirects
app.get( '/about', loadUser, function( req, res ) {
  res.redirect( 'http://blog.finalsclub.org/about.html' );
});

app.get( '/press', loadUser, function( req, res ) {
  res.render( 'static/press' );
});

app.get( '/conduct', loadUser, function( req, res ) {
  res.render( 'static/conduct' );
});

app.get( '/legal', loadUser, function( req, res ) {
  res.redirect( 'http://blog.finalsclub.org/legal.html' );
});

app.get( '/contact', loadUser, function( req, res ) {
  res.redirect( 'http://blog.finalsclub.org/contact.html' );
});

app.get( '/privacy', loadUser, function( req, res ) {
  res.render( 'static/privacy' );
});


// Authentication routes
// These are used for logging in, logging out, registering
// and other user authentication purposes

// Render login page
app.get( '/login', function( req, res ) {
  log3("get login page")

  res.render( 'login' );	
});

// Recieve login form
app.post( '/login', function( req, res ) {
  var email		 = req.body.email;
  var password = req.body.password;
  log3("post login ...")

  // Find user from email
  User.findOne( { 'email' : email.toLowerCase() }, function( err, user ) {
    log3(err) 
    log3(user) 

    // If user exists, check if activated, if not notify them and send them to
    // the login form
    if( user ) {
      if( ! user.activated ) {
        // (undocumented) markdown-esque link functionality in req.flash
        req.flash( 'error', 'This account isn\'t activated. Check your inbox or [click here](/resendActivation) to resend the activation email.' );

        req.session.activateCode = user._id;

        res.render( 'login' );
      } else {
        // If user is activated, check if their password is correct
        if( user.authenticate( password ) ) {
          log3("pass ok") 

          var sid = req.sessionID;

          user.session = sid;

          // Set the session then save the user to the database
          user.save( function() {
            var redirect = req.session.redirect;

            // login complete, remember the user's email for next time
            req.session.email = email;

            // alert the successful login
            req.flash( 'info', 'Successfully logged in!' );

            // redirect to profile if we don't have a stashed request
            res.redirect( redirect || '/profile' );
          });
        } else {
          // Notify user of bad login
          req.flash( 'error', 'Invalid login!' );

          res.render( 'login' );
        }
      }
    } else {
      // Notify user of bad login
      log3("bad login")
      req.flash( 'error', 'Invalid login!' );

      res.render( 'login' );
    }
  });
});

// Request reset password
app.get( '/resetpw', function( req, res ) {
  log3("get resetpw page");
  res.render( 'resetpw' );
});

// Display reset password from requested email
app.get( '/resetpw/:id', function( req, res ) {
  var resetPassCode = req.params.id
  res.render( 'resetpw', { 'verify': true, 'resetPassCode' : resetPassCode } );
});

// Recieve reset password request form
app.post( '/resetpw', function( req, res ) {
  log3("post resetpw");
  var email = req.body.email


  // Search for user
  User.findOne( { 'email' : email.toLowerCase() }, function( err, user ) {
    if( user ) {

      // If user exists, create reset code
      var resetPassCode = hat(64);
      user.setResetPassCode(resetPassCode);

      // Construct url that the user can then click to reset password
      var resetPassUrl = 'http://' + serverHost + ((app.address().port != 80)? ':'+app.address().port: '') + '/resetpw/' + resetPassCode;

      // Save user to database
      user.save( function( err ) {
        log3('save '+user.email);

        // Construct email and send it to the user
        var message = {
          'to'				: user.email,

          'subject'		: 'Your FinalsClub.org Password has been Reset!',

          'template'	: 'userPasswordReset',
          'locals'		: {
            'resetPassCode'		: resetPassCode,
            'resetPassUrl'		: resetPassUrl
          }
        };

        mailer.send( message, function( err, result ) {
          if( err ) {
            // XXX: Add route to resend this email

            console.log( 'Error sending user password reset email!' );
          } else {
            console.log( 'Successfully sent user password reset email.' );
          }

        }); 

        // Render request success page
        res.render( 'resetpw-success', { 'email' : email } );
      });			
    } else {
      // Notify of error
      res.render( 'resetpw-error', { 'email' : email } );
    }
  });
});

// Recieve reset password form
app.post( '/resetpw/:id', function( req, res ) {
  log3("post resetpw.code");
  var resetPassCode = req.params.id
  var email = req.body.email
  var pass1 = req.body.pass1
  var pass2 = req.body.pass2

  // Find user by email
  User.findOne( { 'email' : email.toLowerCase() }, function( err, user ) {
    var valid = false;
    // If user exists, and the resetPassCode is valid, pass1 and pass2 match, then
    // save user with new password and display success message.
    if( user ) {
      var valid = user.resetPassword(resetPassCode, pass1, pass2);
      if (valid) {
        user.save( function( err ) {
          res.render( 'resetpw-success', { 'verify' : true, 'email' : email, 'resetPassCode' : resetPassCode } );		
        });			
      }
    } 

    // If there was a problem, notify user
    if (!valid) {
      res.render( 'resetpw-error', { 'verify' : true, 'email' : email } );
    }
  });
});

// Display registration page
app.get( '/register', function( req, res ) {
  log3("get reg page");

  // Populate school dropdown list
  School.find( {} ).sort( 'name', '1' ).run( function( err, schools ) {
    res.render( 'register', { 'schools' : schools } );
  })
});

// Recieve registration form
app.post( '/register', function( req, res ) {
  var sid = req.sessionId;

  // Create new user from User schema
  var user = new User;

  // Populate user from form
  user.email        = req.body.email.toLowerCase();
  user.password     = req.body.password;
  user.session      = sid;
  // If school is set to other, then fill in school as what the
  // user entered
  user.school				= req.body.school === 'Other' ? req.body.otherSchool : req.body.school;
  user.name         = req.body.name;
  user.affil        = req.body.affil;
  user.activated    = false;

  // Validate email
  if ( ( user.email === '' ) || ( !isValidEmail( user.email ) ) ) {
    req.flash( 'error', 'Please enter a valid email' );
    return res.redirect( '/register' );
  }

  // Check if password is greater than 6 characters, otherwise notify user
  if ( req.body.password.length < 6 ) {
    req.flash( 'error', 'Please enter a password longer than eight characters' );
    return res.redirect( '/register' );
  }

  // Pull out hostname from email
  var hostname = user.email.split( '@' ).pop();

  // Check if email is from one of the special domains
  if( /^(finalsclub.org|sleepless.com)$/.test( hostname ) ) {
    user.admin = true;
  }

  // Save user to database
  user.save( function( err ) {
    // If error, check if it is because the user already exists, if so
    // get the user information and let them know
    if ( err ) {
      if( /dup key/.test( err.message ) ) {
        // attempting to register an existing address
        User.findOne({ 'email' : user.email }, function(err, result ) {
          if (result.activated) {
            // If activated, make sure they know how to contact the admin
            req.flash( 'error', 'There is already someone registered with this email, if this is in error contact info@finalsclub.org for help' )
            return res.redirect( '/register' )
          } else {
            // If not activated, direct them to the resendActivation page
            req.flash( 'error', 'There is already someone registered with this email, if this is you, please check your email for the activation code' )
            return res.redirect( '/resendActivation' )
          }
        });
      } else {
        // If any other type of error, prompt them to enter the registration again
        req.flash( 'error', 'An error occurred during registration.' );

        return res.redirect( '/register' );
      }
    } else {
      // send user activation email
      sendUserActivation( user );

      // Check if the hostname matches any in the approved schools
      School.findOne( { 'hostnames' : hostname }, function( err, school ) {
        if( school ) {
          // If there is a match, send associated welcome message
          sendUserWelcome( user, true );
          log3('school recognized '+school.name);
          // If no users exist for the school, create empty array
          if (!school.users) school.users = [];
          // Add user to the school
          school.users.push( user._id );

          // Save school to the database
          school.save( function( err ) {
            log3('school.save() done');
            // Notify user that they have been added to the school
            req.flash( 'info', 'You have automatically been added to the ' + school.name + ' network. Please check your email for the activation link' );
            res.redirect( '/' );
          });
          // Construct admin email about user registration
          var message = {
            'to'       : ADMIN_EMAIL,

            'subject'  : 'FC User Registration : User added to ' + school.name,

            'template' : 'userSchool',
            'locals'   : {
              'user'   : user
            }
          }
        } else {
          // If there isn't a match, send associated welcome message
          sendUserWelcome( user, false );
          // Tell user to check for activation link
          req.flash( 'info', 'Your account has been created, please check your email for the activation link' )
          res.redirect( '/' );
          // Construct admin email about user registration
          var message = {
            'to'       : ADMIN_EMAIL,

            'subject'  : 'FC User Registration : Email did not match any schools',

            'template' : 'userNoSchool',
            'locals'   : {
              'user'   : user
            }
          }
        }
        // Send email to admin
        mailer.send( message, function( err, result ) {
          if ( err ) {

            console.log( 'Error sending user has no school email to admin\nError Message: '+err.Message );
          } else {
            console.log( 'Successfully sent user has no school email to admin.' );
          }
        })

      });
    }

  });
});

// Display resendActivation request page
app.get( '/resendActivation', function( req, res ) {
  var activateCode = req.session.activateCode;

  // Check if user exists by activateCode set in their session
  User.findById( activateCode, function( err, user ) {
    if( ( ! user ) || ( user.activated ) ) {
      res.redirect( '/' );
    } else {
      // Send activation and redirect to login
      sendUserActivation( user );

      req.flash( 'info', 'Your activation code has been resent.' );

      res.redirect( '/login' );
    }
  });
});

// Display activation page
app.get( '/activate/:code', function( req, res ) {
  var code = req.params.code;

  // XXX could break this out into a middleware
  if( ! code ) {
    res.redirect( '/' );
  }

  // Find user by activation code
  User.findById( code, function( err, user ) {
    if( err || ! user ) {
      // If not found, notify user of invalid code
      req.flash( 'error', 'Invalid activation code!' );

      res.redirect( '/' );
    } else {
      // If valid, then activate user
      user.activated = true;

      // Regenerate our session and log in as the new user
      req.session.regenerate( function() {
        user.session = req.sessionID;

        // Save user to database
        user.save( function( err ) {
          if( err ) {
            req.flash( 'error', 'Unable to activate account.' );

            res.redirect( '/' );
          } else {
            req.flash( 'info', 'Account successfully activated. Please complete your profile.' );

            res.redirect( '/profile' );
          }
        });
      });
    }
  });
});

// Logut user
app.get( '/logout', function( req, res ) {
  var sid = req.sessionID;

  // Find user by session id
  User.findOne( { 'session' : sid }, function( err, user ) {
    if( user ) {
      // Empty out session id
      user.session = '';

      // Save user to database
      user.save( function( err ) {
        res.redirect( '/' );
      });
    } else {
      res.redirect( '/' );
    }
  });
});

// Display users profile page
app.get( '/profile', loadUser, loggedIn, function( req, res ) {
  var user = req.user;

  res.render( 'profile/index', { 'user' : user } );
});

// Recieve profile edit page form
app.post( '/profile', loadUser, loggedIn, function( req, res ) {
  var user		= req.user;
  var fields	= req.body;

  var error				= false;
  var wasComplete	= user.isComplete;

  if( ! fields.name ) {
    req.flash( 'error', 'Please enter a valid name!' );

    error = true;
  } else {
    user.name = fields.name;
  }

  if( [ 'Student', 'Teachers Assistant' ].indexOf( fields.affiliation ) == -1 ) {
    req.flash( 'error', 'Please select a valid affiliation!' );

    error = true;
  } else {
    user.affil = fields.affiliation;
  }

  if( fields.existingPassword || fields.newPassword || fields.newPasswordConfirm ) {
    // changing password
    if( ( ! user.hashed ) || user.authenticate( fields.existingPassword ) ) {
      if( fields.newPassword === fields.newPasswordConfirm ) {
        // test password strength?

        user.password = fields.newPassword;
      } else {
        req.flash( 'error', 'Mismatch in new password!' );

        error = true;
      }
    } else {
      req.flash( 'error', 'Please supply your existing password.' );

      error = true;
    }
  }

  user.major		= fields.major;
  user.bio			= fields.bio;

  user.showName	= ( fields.showName ? true : false );

  if( ! error ) {
    user.save( function( err ) {
      if( err ) {
        req.flash( 'error', 'Unable to save user profile!' );
      } else {
        if( ( user.isComplete ) && ( ! wasComplete ) ) {
          req.flash( 'info', 'Your account is now fully activated. Thank you for joining FinalsClub!' );

          res.redirect( '/' );
        } else {
          res.render( 'info', 'Your profile was successfully updated!' );

          res.render( 'profile/index', { 'user' : user } );
        }
      }
    });
  } else {
    res.render( 'profile/index', { 'user' : user } );
  }
});


// Old Notes

function loadSubject( req, res, next ) {
  if( url.parse( req.url ).pathname.match(/subject/) ) {
    ArchivedSubject.findOne({id: req.params.id }, function(err, subject) {
      if ( err ) {
        req.flash( 'error', 'Subject with this ID does not exist' )
        res.redirect( '/archive' );
      } else {
        req.subject = subject;
        next()
      }
    })
  } else {
    next()
  } 
}

function loadOldCourse( req, res, next ) {
  if( url.parse( req.url ).pathname.match(/course/) ) {
    ArchivedCourse.findOne({id: req.params.id }, function(err, course) {
      if ( err ) {
        req.flash( 'error', 'Course with this ID does not exist' )
        res.redirect( '/archive' );
      } else {
        req.course = course;
        next()
      }
    })
  } else {
    next()
  } 
}

var featuredCourses = [
  {name: 'The Human Mind', 'id': 1563},
  {name: 'Justice', 'id': 797},
  {name: 'Protest Literature', 'id': 1681},
  {name: 'Animal Cognition', 'id': 681},
  {name: 'Positive Psychology', 'id': 1793},
  {name: 'Social Psychology', 'id': 660},
  {name: 'The Book from Gutenberg to the Internet', 'id': 1439},
  {name: 'Cyberspace in Court', 'id': 1446},
  {name: 'Nazi Cinema', 'id': 2586},
  {name: 'Media and the American Mind', 'id': 2583},
  {name: 'Social Thought in Modern America', 'id': 2585},
  {name: 'Major British Writers II', 'id': 869},
  {name: 'Civil Procedure', 'id': 2589},
  {name: 'Evidence', 'id': 2590},
  {name: 'Management of Industrial and Nonprofit Organizations', 'id': 2591},
];

app.get( '/learn', loadUser, function( req, res ) {
  res.render( 'archive/learn', { 'courses' : featuredCourses } );
})

app.get( '/learn/random', loadUser, function( req, res ) {
  res.redirect( '/archive/course/'+ featuredCourses[Math.floor(Math.random()*featuredCourses.length)].id);
})

app.get( '/archive', loadUser, function( req, res ) {
  ArchivedSubject.find({}).sort( 'name', '1' ).run( function( err, subjects ) {
    if ( err ) {
      req.flash( 'error', 'There was a problem gathering the archived courses, please try again later.' );
      res.redirect( '/' );
    } else {
      res.render( 'archive/index', { 'subjects' : subjects } );
    }
  })
})

app.get( '/archive/subject/:id', loadUser, loadSubject, function( req, res ) {
  ArchivedCourse.find({subject_id: req.params.id}).sort('name', '1').run(function(err, courses) {
    if ( err ) {
      req.flash( 'error', 'There are no archived courses' );
      res.redirect( '/' );
    } else {
      res.render( 'archive/courses', { 'courses' : courses, 'subject': req.subject } );
    }
  })
})

app.get( '/archive/course/:id', loadUser, loadOldCourse, function( req, res ) {
  ArchivedNote.find({course_id: req.params.id}).sort('name', '1').run(function(err, notes) {
    if ( err ) {
      req.flash( 'error', 'There are no notes in this course' );
      res.redirect( '/archive' );
    } else {
      res.render( 'archive/notes', { 'notes' : notes, 'course' : req.course } );
    }
  })
})

app.get( '/archive/note/:id', loadUser, function( req, res ) {
  ArchivedNote.findById(req.params.id, function(err, note) {
    if ( err ) {
      req.flash( 'error', 'This is not a valid id for a note' );
      res.redirect( '/archive' );
    } else {
      ArchivedCourse.findOne({id: note.course_id}, function(err, course) {
        if ( err ) {
          req.flash( 'error', 'There is no course for this note' )
          res.redirect( '/archive' )
        } else {
          res.render( 'archive/note', { 'layout' : 'notesLayout', 'note' : note, 'course': course } );
        }
      })
    }
  })
})

// socket.io server

// The finalsclub backchannel server uses socket.io to handle communication between the server and
// the browser which facilitates near realtime interaction. This allows the user to post questions
// and comments and other users to get those almost immediately after they are posted, without
// reloading the page or pressing a button to refresh.
//
// The server code itself is fairly simple, mainly taking incomming messages from client browsers,
// saving the data to the database, and then sending it out to everyone else connected. 
//
// Data types:
// Posts -  Posts are the main items in backchannel, useful for questions or discussion points
// 		[[ example object needed with explanation E.G: 
/*
		Post: { postID: '999-1',
				  userID: '1234',
				  userName: 'Bob Jones',
				  userAffil: 'Instructor',
				  body: 'This is the text content of the post.',
				  comments: { {<commentObj>, <commentObj>, ...},
				  public: true,
				  votes:   [ <userID>, <userID>, ...],
				  reports: [ <userID>, <userID>, ...]
				}
		  Comment: { body: 'foo bar', userName: 'Bob Jones', userAffil: 'Instructor' }
		
		  if anonymous: userName => 'Anonymous', userAffil => 'N/A'
*/
//
//
//
// Comments - Comments are replies to posts, for clarification or answering questions
// 		[[ example object needed]]
// Votes - Votes signifyg a users approval of a post
// 		[[ example object needed]]
// Flags - Flagging a post signifies that it is against the rules, 2 flags moves it to the bottomw
// 		[[ example object needed]]
//
//
// Post Schema
// body - Main content of the post
// userId - Not currently used, but would contain the users id that made the post
// userName - Users name that made post
// userAffil - Users affiliation to their school
// public - Boolean which denotes if the post is public to everyone, or private to school users only
// date - Date post was made, updates when any comments are made for the post
// comments - An array of comments which contain a body, userName, and userAffil
// votes - An array of user ids which are the users that voted
// 		[[ example needed ]]
// reports - An array of user ids which are the users that reported the post
//		[[ reports would be "this post is flagged as inappropriate"? ]]
//		[[ bruml: consistent terminology needed ]]
//
// Posts and comments can be made anonymously. When a post is anonymous, the users info is stripped
// from the post and the userName is set to Anonymous and the userAffil to N/A. This is to allow
// users the ability to make posts or comments that they might not otherwise due to not wanting
// the content of the post/comment to be attributed to them.
//
// Each time a user connects to the server, it passes through authorization which checks for a cookie
// that is set by Express. If a session exists and it is for a valid logged in user, then handshake.user
// is set to the users data, otherwise it is set to false. handshake.user is used later on to check if a
// user is logged in, and if so display information that otherwise might not be visible to them if they
// aren't apart of a particular school.
//
// After the authorization step, the client browser sends the lecture id which is rendered into the html
// page on page load from Express. This is then used to assign a 'room' for the user which is grouped
// by lecture. All posts are grouped by lecture, and only exist for that lecture. After the user is
// grouped into a 'room', they are sent a payload of all existing posts for that lecture, which are then
// rendered in the browser.
//
// Everything else from this point on is handled in an event form and requires a user initiating it. The
// events are as follows.
//
// Post event
// A user makes a new post. A payload of data containing the post and lecture id is sent to the server.
// The server recieves the data, assembles a new post object for the database and then fills it with
// the appropriate data. If a user selected for the post to be anonymous, the userName and userAffil are
// replaced. If the user chose for the post to be private, then public will be set to false and it
// will be filtered from being sent to users not logged into and not having access to the school. Once
// the post has been created and saved into the database, it is sent to all connected users to that
// particular lecture, unless it is private, than only logged in users will get it.
//
// Vote event
// A user votes for a post. A payload of data containing the post id and lecture id are sent along with
// the user id. A new vote is created by first fetching the parent post, then adding the user id to the
// votes array, and then the post is subsequently saved back to the database and sent to all connected
// users unless the post is private, which then it will be only sent to logged in users.
//
// Report event
// Similar to the vote event, reports are sent as a payload of a post id, lecture id, and user id, which
// are then used to fetch the parent post, add the user id to the reports array, and then saved to the db.
// Then the report is sent out to all connected users unless it is a private post, which will be only sent
// to logged in users. On the client, once a post has more two (2) or more reports, it will be moved to the
// bottom of the interface.
//
// Comment event
// A user posts a comment to a post. A payload of data containing the post id, lecture id, comment body,
// user name, and user affiliation are sent to the server, which are then used to find the parent post
// and then a new comment object is assembled. When new comments are made, it updates the posts date
// which allows the post to be sorted by date and the posts with the freshest comments would be pushed
// to the top of the interface. The comment can be anonymous, which then will have the user
// name and affiliation stripped before saving to the database. The comment then will be sent out to all
// connected users unless the post is private, then only logged in users will recieve the comment.

var io = require( 'socket.io' ).listen( app );

var Post = mongoose.model( 'Post' );

io.set('authorization', function ( handshake, next ) {
  var rawCookie = handshake.headers.cookie;
  if (rawCookie) {
    handshake.cookie = parseCookie(rawCookie);
    handshake.sid = handshake.cookie['connect.sid'];

    if ( handshake.sid ) {
      app.set( 'sessionStore' ).get( handshake.sid, function( err, session ) {
        if( err ) {
          handshake.user = false;
          return next(null, true);
        } else {
          // bake a new session object for full r/w
          handshake.session = new Session( handshake, session );

          User.findOne( { session : handshake.sid }, function( err, user ) {
            if( user ) {
              handshake.user = user;
              return next(null, true);
            } else {
              handshake.user = false;
              return next(null, true);
            }
          });
        }
      })
    }
  } else {
    data.user = false;
    return next(null, true);
  }
});


var backchannel = io
.of( '/backchannel' )
.on( 'connection', function( socket ) {

  socket.on('subscribe', function(lecture, cb) {
    socket.join(lecture);
    Post.find({'lecture': lecture}, function(err, posts) {
      if (socket.handshake.user) {
        cb(posts);
      } else {
        var posts = posts.filter(
          function(post) {
          if (post.public)
            return post;
        }
        )
        cb(posts)
      }
    });
  });

  socket.on('post', function(res) {
    var post = new Post;
    var _post = res.post;
    var lecture = res.lecture;
    post.lecture = lecture;
    if ( _post.anonymous ) {
      post.userid		= 0;
      post.userName	= 'Anonymous';
      post.userAffil = 'N/A';
    } else {
      post.userName = _post.userName;
      post.userAffil = _post.userAffil;
    }

    post.public = _post.public;
    post.date = new Date();
    post.body = _post.body;
    post.votes = [];
    post.reports = [];
    post.save(function(err) {
      if (err) {
        // XXX some error handling
        console.log(err);
      } else {
        if (post.public) {
          backchannel.in(lecture).emit('post', post);
        } else {
          privateEmit(lecture, 'post', post);
        }
      }
    });
  });

  socket.on('vote', function(res) {
    var vote = res.vote;
    var lecture = res.lecture;
    Post.findById(vote.parentid, function( err, post ) {
      if (!err) {
        if (post.votes.indexOf(vote.userid) == -1) {
          post.votes.push(vote.userid);
          post.save(function(err) {
            if (err) {
              // XXX error handling
            } else {
              if (post.public) {
                backchannel.in(lecture).emit('vote', vote);
              } else {
                privteEmit(lecture, 'vote', vote);
              }
            }
          });
        }
      }
    })
  });

  socket.on('report', function(res) {
    var report = res.report;
    var lecture = res.lecture;
    Post.findById(report.parentid, function( err, post ){
      if (!err) {
        if (post.reports.indexOf(report.userid) == -1) {
          post.reports.push(report.userid);
          post.save(function(err) {
            if (err) {
              // XXX error handling
            } else {
              if (post.public) {
                backchannel.in(lecture).emit('report', report);
              } else {
                privateEmit(lecture, 'report', report);
              }
            }
          });
        }
      }
    })
  });

  socket.on('comment', function(res) {
    var comment = res.comment;
    var lecture = res.lecture;
    console.log('anon', comment.anonymous);
    if ( comment.anonymous ) {
      comment.userid		= 0;
      comment.userName	= 'Anonymous';
      comment.userAffil = 'N/A';
    }
    Post.findById(comment.parentid, function( err, post ) {
      if (!err) {
        post.comments.push(comment);
        post.date = new Date();
        post.save(function(err) {
          if (err) {
            console.log(err);
          } else {
            if (post.public) {
              backchannel.in(lecture).emit('comment', comment);
            } else {
              privateEmit(lecture, 'comment', comment);
            }
          }
        })
      }
    })
  });

  function privateEmit(lecture, event, data) {
    backchannel.clients(lecture).forEach(function(socket) {
      if (socket.handshake.user)
        socket.emit(event, data);
    })
  }

  socket.on('disconnect', function() {
    //delete clients[socket.id];
  });
});


var counters = {};

var counts = io
.of( '/counts' )
.on( 'connection', function( socket ) {
  // pull out user/session information etc.
  var handshake = socket.handshake;
  var userID		= handshake.user._id;

  var watched		= [];
  var noteID		= null;

  var timer			= null;

  socket.on( 'join', function( note ) {
    if (handshake.user === false) {
      noteID			= note;
      // XXX: replace by addToSet (once it's implemented in mongoose)
      Note.findById( noteID, function( err, note ) {
        if( note ) {
          if( note.collaborators.indexOf( userID ) == -1 ) {
            note.collaborators.push( userID );
            note.save();
          }
        }
      });
    }
  });

  socket.on( 'watch', function( l ) {
    var sendCounts = function() {
      var send = {};

      Note.find( { '_id' : { '$in' : watched } }, function( err, notes ) {
        async.forEach(
          notes,
          function( note, callback ) {
            var id		= note._id;
            var count	= note.collaborators.length;

            send[ id ] = count;

            callback();
          }, function() {
            socket.emit( 'counts', send );

            timer = setTimeout( sendCounts, 5000 );
          }
        );
      });
    }

    Note.find( { 'lecture' : l }, [ '_id' ], function( err, notes ) {
      notes.forEach( function( note ) {
        watched.push( note._id );
      });
    });

    sendCounts();
  });

  socket.on( 'disconnect', function() {
    clearTimeout( timer );

    if (handshake.user === false) {
      // XXX: replace with $pull once it's available
      if( noteID ) {
        Note.findById( noteID, function( err, note ) {
          if( note ) {
            var index = note.collaborators.indexOf( userID );

            if( index != -1 ) {
              note.collaborators.splice( index, 1 );
            }

            note.save();
          }
        });
      }
    }
  });
});

// Exception Catch-All

process.on('uncaughtException', function (e) {
  console.log("!!!!!! UNCAUGHT EXCEPTION\n" + e.stack);
});


// Launch

mongoose.connect( app.set( 'dbUri' ) );
mongoose.connection.db.serverConfig.connection.autoReconnect = true

var mailer = new Mailer( app.set('awsAccessKey'), app.set('awsSecretKey') );

app.listen( serverPort, function() {
  console.log( "Express server listening on port %d in %s mode", app.address().port, app.settings.env );

  // if run as root, downgrade to the owner of this file
  if (process.getuid() === 0) {
    require('fs').stat(__filename, function(err, stats) {
      if (err) { return console.log(err); }
      process.setuid(stats.uid);
    });
  }
});

function isValidEmail(email) {
  var re = /[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/;
  return email.match(re);
}
