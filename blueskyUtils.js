import pkg from "@atproto/api";
const { RichText, AtpAgent } = pkg;
import fs from "fs/promises";
import fsSync from "fs";
import sharp from "sharp";

export default {
  getLoggedInAgent: async (config, sessionFilePath) => {
    try {
      await fs.access(sessionFilePath);
    } catch (error) {
      console.log("Creating new session file");
      await fs.writeFile(sessionFilePath, JSON.stringify({}));
    }
    const fileContents = await fs.readFile(sessionFilePath);
    const sessionData = JSON.parse(fileContents);
    let agent = new AtpAgent({
      service: config.instance,
      persistSession: (evt, sessionObj) => {
        if (["create", "update"].includes(evt)) {
          console.log(`Session action: ${evt}. Persisting session data to ${sessionFilePath}`);
          const json = JSON.stringify(sessionObj, null, 2);
          fsSync.writeFileSync(sessionFilePath, json);
        } else {
          console.log(`Unhandled session action: ${evt}. This might be normal.`);
        }
      },
    });

    try {
      await agent.resumeSession(sessionData);
    } catch (e) {
      console.log("Failed to resume session", e);
      console.log("Logging in with credentials");
      await agent.login({
        identifier: config.identifier,
        password: config.password,
      });
    }

    return agent;
  },
  createPost: async (agent, content, identifier, mentionNotification = null) => {
    const richText = new RichText({
      text: content,
    });

    await richText.detectFacets();

    let post = {
      text: richText.text,
      facets: richText.facets,
      createdAt: new Date().toISOString(),
    };

    if (mentionNotification) {
      if (mentionNotification.reason === "quote") {
        // quote posts
        post.embed = {
          $type: "app.bsky.embed.record",
          record: {
            cid: mentionNotification.cid,
            uri: mentionNotification.uri,
          },
        };
      } else {
        // replies and mentions
        let rootCid = mentionNotification.cid;
        let rootUri = mentionNotification.uri;
        let parentCid = mentionNotification.cid;
        let parentUri = mentionNotification.uri;

        if (mentionNotification.record.reply?.root) {
          rootCid = mentionNotification.record.reply.root.cid;
          rootUri = mentionNotification.record.reply.root.uri;
        }
        post.reply = {
          root: {
            uri: rootUri,
            cid: rootCid,
          },
          parent: {
            uri: parentUri,
            cid: parentCid,
          },
        };
      }
    }

    const postResponse = await agent.post(post);

    const splitUri = postResponse.uri.split("/");
    const postId = splitUri[splitUri.length - 1];
    const postUrl = `https://bsky.app/profile/${identifier}/post/${postId}`;

    return {
      postUrl: postUrl,
      ...postResponse,
    };
  },
  getMentions: async (agent) => {
    const response = await agent.listNotifications();
    const validReasons = ["mention", "reply", "quote"];
    const mentions = response.data.notifications.filter((n) => validReasons.includes(n.reason) && !n.isRead);
    await agent.updateSeenNotifications();
    return mentions;
  },
  createPostWithImage: async (agent, content, identifier, image) => {
    const richText = new RichText({
      text: content,
    });

    await richText.detectFacets();
    const imagePath = image ? image.url : null;
    const imageType = image ? image.type : null;
    const imageAltText = image ? image.alt : null;
    let imageBlob = null;

    let embedData = undefined;

    if (imagePath && imageType) {
      imageBlob = await uploadImage(agent, imagePath, imageType);

      embedData = {
        $type: "app.bsky.embed.images",
        images: [
          {
            image: imageBlob,
            alt: imageAltText,
          },
        ],
      };
    }

    const postResponse = await agent.post({
      text: richText.text,
      facets: richText.facets,
      embed: embedData,
      createdAt: new Date().toISOString(),
    });

    const splitUri = postResponse.uri.split("/");
    const postId = splitUri[splitUri.length - 1];
    const postUrl = `https://bsky.app/profile/${identifier}/post/${postId}`;

    return {
      postUrl: postUrl,
      ...postResponse,
    };
  },
};
async function resizeImage(imageArrayBuffer, imageType, maxWidth, maxHeight) {
  let resizedImage = sharp(imageArrayBuffer).rotate().resize(maxWidth, maxHeight, {
    fit: sharp.fit.inside,
    withoutEnlargement: true,
  });

  if (imageType.includes("png")) {
    resizedImage = resizedImage.png({ quality: 60 });
  } else if (imageType.includes("jpeg") || imageType.includes("jpg")) {
    resizedImage = resizedImage.jpeg({ quality: 60 });
  }

  return await resizedImage.toBuffer();
}

async function uploadImage(agent, imagePath, imageType) {
  let imageArrayBuffer;
  imageArrayBuffer = await downloadImage(imagePath);
  const resizedImageBuffer = await resizeImage(imageArrayBuffer, imageType, 800, 800);
  const imageBufferAsUIntArray = new Uint8Array(resizedImageBuffer);
  const uploadResponse = await agent.uploadBlob(imageBufferAsUIntArray, {
    encoding: imageType,
  });
  return uploadResponse.data.blob;
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return arrayBuffer;
}
