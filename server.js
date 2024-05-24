const express = require('express');
const path = require('path');
const fs = require('fs');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const NodeID3 = require('node-id3');
const axios = require('axios');

const app = express();
const port = 3000;

console.log('Starting server...');

if (!fs.existsSync('./downloads')) {
    fs.mkdirSync('./downloads');
}

app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'docs')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

function sanitizeFilename(filename) {
    return filename.replace(/[<>:"\/\\|?*]+/g, '').trim();
}

app.post('/convert', async (req, res) => {
    console.log('Received request to convert:', req.body['youtube-url']);
    const youtubeUrl = req.body['youtube-url'];
    const videoId = youtubeUrl.split('v=')[1];

    try {
        const info = await ytdl.getInfo(youtubeUrl);
        let title = info.videoDetails.title;
        const artist = info.videoDetails.author.name;

        // Simplify the title for better search results
        title = title.replace(/\(.*?\)/g, '').trim(); // Remove content within parentheses

        // Fetch metadata and album art from iTunes
        const searchTerm = `${artist} ${title}`;
        const itunesResponse = await axios.get(`https://itunes.apple.com/search`, {
            params: {
                term: searchTerm,
                limit: 1,
                media: 'music'
            }
        });

        const itunesData = itunesResponse.data.results[0];
        const album = itunesData ? itunesData.collectionName : 'Unknown Album';
        const albumArtUrl = itunesData ? itunesData.artworkUrl100.replace('100x100bb', '600x600bb') : null;

        console.log('iTunes API response:', itunesData);

        // Generate a safe filename
        const safeTitle = sanitizeFilename(title);
        const outputFilePath = path.join(__dirname, 'downloads', `${safeTitle}.mp3`);

        const stream = ytdl(youtubeUrl, { quality: 'highestaudio' });
        ffmpeg(stream)
            .audioBitrate(128)
            .save(outputFilePath)
            .on('end', async () => {
                console.log('Conversion finished:', outputFilePath);

                // Add ID3 tags
                const tags = {
                    title: title,
                    artist: artist,
                    album: album,
                    image: albumArtUrl ? await axios.get(albumArtUrl, { responseType: 'arraybuffer' }).then(response => response.data) : undefined
                };

                NodeID3.write(tags, outputFilePath, (err) => {
                    if (err) {
                        console.error('Error writing ID3 tags:', err);
                        return res.status(500).send('Error writing ID3 tags');
                    }

                    // Read and log ID3 tags for verification
                    const writtenTags = NodeID3.read(outputFilePath);
                    console.log('ID3 Tags:', writtenTags);

                    res.download(outputFilePath, `${safeTitle}.mp3`, (err) => {
                        if (err) {
                            console.error('Error downloading file:', err);
                        } else {
                            fs.unlink(outputFilePath, (err) => {
                                if (err) console.error('Error deleting file:', err);
                            });
                        }
                    });
                });
            })
            .on('error', (err) => {
                console.error('Conversion error:', err);
                res.status(500).send('Conversion error');
            });
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).send('Conversion error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
