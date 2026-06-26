import blueskyUtils from "./blueskyUtils.js";
import config from "./config.js";

//note: this test requires that the config be populated with a valid identifier and password
const agent = await blueskyUtils.getLoggedInAgent(config, "data/test-session.json");
const post = await blueskyUtils.createPost(agent, "just running a test!", config.identifier);
const postWithImages = await blueskyUtils.createPostWithImages(
  agent,
  "just running a test with an image!",
  config.identifier,
  [
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 1",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 2",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 3",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 4",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 5 should not post",
    },
  ]
);
const postWithGallery = await blueskyUtils.createPostWithImages(
  agent,
  "just running a test with an image gallery!",
  config.identifier,
  [
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 2",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 3",
    },
    {
      url: "https://rardk64.com/get-image/?i=1760366849__68ed11016e010.png",
      type: "image/png",
      alt: "hello world 4 should compress",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 5",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 6",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 7",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 8",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 9",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 10",
    },
    {
      url: "https://rardk64.com/get-image/?i=1728848636__image.png",
      type: "image/png",
      alt: "hello world 11 should not post",
    },
  ]
);
const postWithoutImages = await blueskyUtils.createPostWithImages(
  agent,
  "just running a test without images!",
  config.identifier
);
