import blueskyUtils from "./blueskyUtils.js";
import config from "./config.js";

//note: this test requires that the config be populated with a valid identifier and password
const agent = await blueskyUtils.getLoggedInAgent(config, "data/test-session.json");
const post = await blueskyUtils.createPost(agent, "just running a test!", config.identifier);
