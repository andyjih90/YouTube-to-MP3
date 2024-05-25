const express = require("express");
const path = require("path");
const fs = require("fs");
const ytdl = require("ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const NodeID3 = require("node-id3");
const axios = require("axios");

const app = express();
const port = 3000;

if (!fs.existsSync("./downloads")) {
  fs.mkdirSync("./downloads");
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"\\/|?*]+/g, "").trim();
}

app.post("/convert", async (req, res) => {
  const youtubeUrl = req.body["youtube-url"];
  const videoId = youtubeUrl.split("v=")[1];

  console.log("Received request to convert:", youtubeUrl);

  try {
    const info = await ytdl.getInfo(youtubeUrl);
    let title = info.videoDetails.title;
    const artist = info.videoDetails.author.name;

    title = title.replace(/\(.*?\)/g, "").trim();

    const searchTerm = `${artist} ${title}`;
    const itunesResponse = await axios.get(`https://itunes.apple.com/search`, {
      params: {
        term: searchTerm,
        limit: 1,
        media: "music",
      },
    });

    const itunesData = itunesResponse.data.results[0];
    const album = itunesData ? itunesData.collectionName : "Unknown Album";
    const albumArtUrl = itunesData
      ? itunesData.artworkUrl100.replace("100x100bb", "600x600bb")
      : null;

    console.log("iTunes API response:", itunesData);

    const safeTitle = sanitizeFilename(title);
    const outputFilePath = path.join(
      __dirname,
      "downloads",
      `${safeTitle}.mp3`
    );

    const stream = ytdl(youtubeUrl, { quality: "highestaudio" });
    ffmpeg(stream)
      .audioBitrate(128)
      .save(outputFilePath)
      .on("end", async () => {
        console.log("Conversion completed, processing tags...");

        const tags = {
          title: title,
          artist: artist,
          album: album,
          image: albumArtUrl
            ? await axios
                .get(albumArtUrl, { responseType: "arraybuffer" })
                .then((response) => response.data)
            : undefined,
        };

        NodeID3.write(tags, outputFilePath, (err) => {
          if (err) {
            console.error("Error writing ID3 tags:", err);
            return res.redirect(
              `/?error=${encodeURIComponent(
                "Error writing ID3 tags. Please try again."
              )}`
            );
          }

          const writtenTags = NodeID3.read(outputFilePath);
          console.log("ID3 Tags:", writtenTags);

          // Log the thumbnail URL to ensure it's being fetched
          const thumbnailUrl = info.videoDetails.thumbnails[0]?.url;
          console.log("Thumbnail URL:", thumbnailUrl);

          res.redirect(
            `/result.html?title=${encodeURIComponent(
              title
            )}&channel=${encodeURIComponent(artist)}&views=${
              info.videoDetails.viewCount
            }&thumbnail=${encodeURIComponent(
              thumbnailUrl
            )}&file=${encodeURIComponent(outputFilePath)}`
          );
        });
      })
      .on("error", (err) => {
        console.error("Conversion error:", err);
        res.redirect(
          `/?error=${encodeURIComponent(
            "Conversion error. Please enter a valid link and try again."
          )}`
        );
      });
  } catch (error) {
    console.error("Conversion error:", error);
    res.redirect(
      `/?error=${encodeURIComponent(
        "Conversion error. Please enter a valid link and try again."
      )}`
    );
  }
});

// Endpoint to handle file download
app.get("/download", (req, res) => {
  const filePath = decodeURIComponent(req.query.file);
  res.download(filePath, (err) => {
    if (err) {
      console.error("File download error:", err);
      res.status(500).send("File download failed.");
    }
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
