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
// bluesky's limit is 2MB per image and it shows them at 2000px max
const MAX_IMAGE_BYTES = 1_950_000;
const MAX_IMAGE_DIMENSION = 2000;
// lower quality first, only shrink if that's not enough
const FALLBACK_DIMENSIONS = [MAX_IMAGE_DIMENSION, 1600, 1200];
const JPEG_QUALITIES = [90, 85, 80, 75];

// leaves the image alone if it already fits, since re-compressing makes it worse
async function prepareImage(imageArrayBuffer, imageType) {
  const buffer = Buffer.from(imageArrayBuffer);
  const metadata = await sharp(buffer).metadata();

  // sideways photos (exif 5-8) have width and height flipped
  const orientation = metadata.orientation ?? 1;
  const width = orientation >= 5 ? metadata.height : metadata.width;
  const height = orientation >= 5 ? metadata.width : metadata.height;
  const format = metadata.format; // from the file itself, not imageType

  // step 1: already fits, send as is
  const passthroughMimeType = { jpeg: "image/jpeg", png: "image/png" }[format];
  if (
    passthroughMimeType &&
    orientation === 1 &&
    buffer.byteLength <= MAX_IMAGE_BYTES &&
    Math.max(width, height) <= MAX_IMAGE_DIMENSION
  ) {
    console.log(`Image is ${kb(buffer.byteLength)} KB at ${width}x${height}, uploading original.`);
    return { data: buffer, width, height, mimeType: passthroughMimeType };
  }

  // pngs are usually screenshots, keep full colour detail so text stays sharp
  const isGraphic = format === "png" || (imageType ?? "").includes("png");
  const resized = (dimension) =>
    sharp(buffer).rotate().resize(dimension, dimension, {
      fit: sharp.fit.inside,
      withoutEnlargement: true,
    });

  let smallest = null;
  const consider = (result, mimeType, label) => {
    const { data, info } = result;
    console.log(`Image ${label}: ${kb(info.size)} KB at ${info.width}x${info.height}`);
    const candidate = { data, width: info.width, height: info.height, mimeType };
    if (!smallest || info.size < smallest.data.byteLength) {
      smallest = candidate;
    }
    return info.size <= MAX_IMAGE_BYTES ? candidate : null;
  };

  // step 2: lossless png. no `quality` here, sharp drops it to 256 colours if you do
  if (isGraphic) {
    const png = await resized(MAX_IMAGE_DIMENSION)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });
    const fit = consider(png, "image/png", "as lossless PNG");
    if (fit) return fit;
  }

  // step 3: jpeg until it fits (transparency becomes white)
  for (const dimension of FALLBACK_DIMENSIONS) {
    for (const quality of JPEG_QUALITIES) {
      const jpeg = await resized(dimension)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: isGraphic ? "4:4:4" : "4:2:0" })
        .toBuffer({ resolveWithObject: true });
      const fit = consider(jpeg, "image/jpeg", `as JPEG q${quality} (max ${dimension}px)`);
      if (fit) return fit;
    }
  }

  console.warn(`Could not get image under ${kb(MAX_IMAGE_BYTES)} KB; uploading smallest attempt.`);
  return smallest;
}

function kb(bytes) {
  return Math.round(bytes / 1024);
}

async function uploadImage(agent, imagePath, imageType) {
  const imageArrayBuffer = await downloadImage(imagePath);
  const { data, width, height, mimeType } = await prepareImage(imageArrayBuffer, imageType);
  const imageBufferAsUIntArray = new Uint8Array(data);
  const uploadResponse = await agent.uploadBlob(imageBufferAsUIntArray, {
    encoding: mimeType,
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
