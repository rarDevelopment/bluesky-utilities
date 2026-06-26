import { RichText, AtpAgent } from "@atproto/api";
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
    let sessionData = JSON.parse(fileContents);
    if (config.identifier !== sessionData.handle) {
      sessionData = null;
    }
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
  createPostWithImages: async (agent, content, identifier, images) => {
    const richText = new RichText({
      text: content,
    });

    await richText.detectFacets();

    const imageCount = images?.length || 0;
    let uploadedImages = [];

    // images embed caps at 4; gallery embed allows more (soft limit 10)
    for (let i = 0; i < imageCount && uploadedImages.length < 10; i++) {
      const image = images[i];
      const imagePath = image ? image.url : null;
      const imageType = image ? image.type : null;
      const imageAltText = image ? image.alt : null;

      if (imagePath && imageType) {
        const { blob, aspectRatio } = await uploadImage(agent, imagePath, imageType);
        uploadedImages.push({
          image: blob,
          alt: imageAltText ?? "",
          aspectRatio,
        });
      }
    }

    let embedData = undefined;
    if (uploadedImages.length > 4) {
      embedData = {
        $type: "app.bsky.embed.gallery",
        items: uploadedImages.map((img) => ({
          $type: "app.bsky.embed.gallery#image",
          ...img,
        })),
      };
    } else if (uploadedImages.length > 0) {
      embedData = {
        $type: "app.bsky.embed.images",
        images: uploadedImages,
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
  const pipeline = sharp(imageArrayBuffer).rotate().resize(maxWidth, maxHeight, {
    fit: sharp.fit.inside,
    withoutEnlargement: true,
  });

  const encode = (quality) => {
    if (imageType.includes("png")) {
      return pipeline.png({ quality });
    } else if (imageType.includes("jpeg") || imageType.includes("jpg")) {
      return pipeline.jpeg({ quality });
    }
    return pipeline;
  };

  let { data, info } = await encode(90).toBuffer({ resolveWithObject: true });
  let kbSize = info.size / 1024;
  console.log(`Image size after initial resize: ${kbSize} KB`);

  if (kbSize > 1900) {
    console.log("Image is larger than 1900 KB, compressing further");
    ({ data, info } = await encode(70).toBuffer({ resolveWithObject: true }));
    kbSize = info.size / 1024;
    console.log(`Image compressed to ${kbSize} KB, going ahead with that.`);
  }

  return { data, width: info.width, height: info.height };
}

async function uploadImage(agent, imagePath, imageType) {
  const imageArrayBuffer = await downloadImage(imagePath);
  const { data, width, height } = await resizeImage(imageArrayBuffer, imageType, 800, 800);
  const imageBufferAsUIntArray = new Uint8Array(data);
  const uploadResponse = await agent.uploadBlob(imageBufferAsUIntArray, {
    encoding: imageType,
  });
  return {
    blob: uploadResponse.data.blob,
    aspectRatio: { width, height },
  };
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return arrayBuffer;
}
