import blueskyUtils from "./blueskyUtils.js";
import config from "./config.js";

//note: this test requires that the config be populated with a valid identifier and password
const agent = await blueskyUtils.getLoggedInAgent(config, "data/test-session.json");
const post = await blueskyUtils.createPost(agent, "just running a test!", config.identifier);
const postWithImage = await blueskyUtils.createPostWithImage(
  agent,
  "just running a test with an image!",
  config.identifier,
  {
    url: "https://rardk64.com/get-image/?i=1728848636__image.png",
    type: "image/png",
    alt: "hello world",
  }
);
