const path = require('path');
const bodyParser = require('body-parser');
const config = require('./config');
var Bullmq =  require('bullmq');
const processDownload = require('./queues/download.js');
const processTrim = require('./queues/trim.js');
const processTweet = require('./queues/tweet.js');
var IORedis = require('ioredis');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'clipshare' },
  transports: [
    new transports.Console({format: format.simple()})
  ],
});

//load helper library for interacting with Twitter
const Twitter = require('./controllers/twitter.js');
const T = new Twitter(config.twitter.consumer_key,config.twitter.consumer_key_secret)
//load helper library for interacting with AWS
const AWSLib = require('./controllers/aws.js')
const AWS = new AWSLib(config)

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port
});
const downloadQueue = new Bullmq.Queue('video download',{ connection });
const trimQueue = new Bullmq.Queue('trim video',{ connection });
const tweetQueue = new Bullmq.Queue('tweet video',{ connection });

const downloadWorker = new Bullmq.Worker('video download', processDownload, { connection });
downloadWorker.on("completed", (job, response) => {
  logger.info(`Download job was successful with response ${response}`)
  io.emit(job.data.ws + "-download-finish", {status: "success",response: response});
});
downloadWorker.on("failed", (job, failedReason) => {
  logger.error(`Failed download job`)
	logger.error(failedReason);
  io.emit(job.data.ws + "-download-finish", {status: "failed",response: failedReason});
});
const trimWorker = new Bullmq.Worker('trim video', processTrim, { connection });
trimWorker.on("completed", (job, response) => {
  logger.info(`Trim job was successful with response ${response}`)
  io.emit(job.data.ws + "-trim-finish", {status: "success",response: response});
});
trimWorker.on("failed", (job, failedReason) => {
  logger.error(`Failed trim job`)
	logger.error(failedReason);
  io.emit(job.data.ws + "-trim-finish", {status: "failed",response: failedReason});
});
const tweetWorker = new Bullmq.Worker('tweet video', processTweet, { connection });
tweetWorker.on("completed", (job, response) => {
  logger.info(`Tweet job was successful with response ${response}`)
  io.emit(job.data.ws + "-tweet-finish", {status: "success",response: response});
});
tweetWorker.on("failed", (job, failedReason) => {
  logger.error(`Failed tweet job`)
	logger.error(failedReason);
  io.emit(job.data.ws + "-tweet-finish", {status: "failed",response: failedReason});
});

const cors = require('cors');
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

app.use(express.json({
  inflate: true,
  limit: '10kb',
  reviver: null,
  strict: true,
  type: 'application/json',
  verify: undefined
}))
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors())
app.use(express.static(path.join(__dirname,'media')));
app.use(express.static(path.join(__dirname,'files')));

app.use(function (req, res, next) {
  req.queues = {
    download: downloadQueue,
    trim: trimQueue,
    tweet: tweetQueue,
  }
  req.twitter = T
  req.aws = AWS
  req.logger = logger
  next();
});

app.use('/health', require('./routes/health.js'));
app.use('/user', require('./routes/user.js'))
app.use('/tweet', require('./routes/tweet.js'))
app.use('/video', require('./routes/video.js'))
app.use('/auth', require('./routes/auth.js'))

server.listen(config.app.port, () => {
  console.log(`server is listening on port ${config.app.port}`);
});
