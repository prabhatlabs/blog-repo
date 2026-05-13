import { Glob } from "bun";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const BLOGS_DIR = "./blogs";
const IMAGES_DIR = "./blog-images";
const INDEX_FILE = "./data/blog-index.json";

/**
 * Uploads local images to Cloudinary using direct API calls (no SDK).
 */
async function uploadImages() {
    const cloudinaryUrl = process.env.CLOUDINARY_URL;
    if (!cloudinaryUrl) {
        throw new Error("CLOUDINARY_URL not found. Skipping image uploads.");
    }

    let uploads: Record<string, string> = {};
    try {
        const urlMatch = cloudinaryUrl.match(
            /cloudinary:\/\/([^:]+):([^@]+)@(.+)/,
        );
        if (!urlMatch) {
            throw new Error("Invalid CLOUDINARY_URL. Skipping image uploads.");
        }

        const [, apiKey, apiSecret, cloudName] = urlMatch;
        const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
        const glob = new Glob("**/*.{jpg,jpeg,png,webp,gif,svg}");

        for await (const file of glob.scan({
            cwd: IMAGES_DIR,
            onlyFiles: true,
        })) {
            const localPath = path.join(IMAGES_DIR, file);
            const folder = `blog-images/${path.dirname(file).replace(/\\/g, "/")}`;
            const publicId = path.basename(file, path.extname(file));

            console.log(`Uploading ${file} to Cloudinary...`);

            try {
                const timestamp = Math.round(new Date().getTime() / 1000);
                const signatureStr = `folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}&use_filename=true${apiSecret}`;

                const signature = new Bun.CryptoHasher("sha1")
                    .update(signatureStr)
                    .digest("hex");

                const formData = new FormData();
                formData.append("file", Bun.file(localPath));
                formData.append("api_key", apiKey!);
                formData.append("timestamp", timestamp.toString());
                formData.append("signature", signature);
                formData.append("folder", folder);
                formData.append("public_id", publicId);
                formData.append("overwrite", "true");
                formData.append("use_filename", "true");

                const response = await fetch(uploadUrl, {
                    method: "POST",
                    body: formData,
                });

                const result = (await response.json()) as any;

                if (result.secure_url) {
                    uploads[localPath] = result.secure_url;
                    console.log(
                        `Successfully uploaded ${file} -> ${result.secure_url}`,
                    );
                    await unlink(localPath);
                    console.log(`Deleted local file: ${localPath}`);
                } else {
                    console.error(
                        `Upload failed for ${file}:`,
                        result.error?.message || result,
                    );
                }
            } catch (error) {
                console.error(`Failed to upload ${file}:`, error);
            }
        }

        // Thorough cleanup: Delete everything inside IMAGES_DIR (subfolders and any remaining files)
        // We set onlyFiles: false to ensure we catch directories
        const cleanupGlob = new Glob("*");
        for await (const entry of cleanupGlob.scan({
            cwd: IMAGES_DIR,
            onlyFiles: false,
        })) {
            const entryPath = path.join(IMAGES_DIR, entry);
            try {
                await rm(entryPath, { recursive: true, force: true });
                console.log(`Cleaned up: ${entryPath}`);
            } catch (e) {
                console.warn(`Failed to cleanup ${entryPath}:`, e);
            }
        }
    } catch (e) {
        console.warn(`Failed to upload image:`, e);
    }

    return uploads;
}

/**
 * A simple frontmatter parser for MDX files.
 * Extracts key-value pairs between the first two '---' markers.
 */
function parseFrontmatter(content: string) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const frontmatterRaw = match[1];
    const metadata: Record<string, any> = {};

    if (!frontmatterRaw) return metadata;

    const lines = frontmatterRaw.split(/\r?\n/);
    for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim();
        let value: any = line.slice(colonIndex + 1).trim();

        // Handle JSON-like arrays: ["tag1", "tag2"]
        if (value.startsWith("[") && value.endsWith("]")) {
            value = value
                .slice(1, -1)
                .split(",")
                .map((s: string) => s.trim().replace(/^["'](.*)["']$/, "$1"));
        }
        // Handle quoted strings
        else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        // Handle booleans
        else if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        }
        // Handle numbers if any
        else if (!isNaN(Number(value)) && value !== "") {
            value = Number(value);
        }

        metadata[key] = value;
    }

    return metadata;
}

/**
 * Serializes a metadata object back into a frontmatter string.
 */
function serializeFrontmatter(metadata: Record<string, any>) {
    let yaml = "---\n";
    for (const [key, value] of Object.entries(metadata)) {
        if (Array.isArray(value)) {
            yaml += `${key}: [${value.map((v) => `"${v}"`).join(", ")}]\n`;
        } else if (typeof value === "string") {
            yaml += `${key}: "${value}"\n`;
        } else {
            yaml += `${key}: ${value}\n`;
        }
    }
    yaml += "---";
    return yaml;
}

async function main() {
    const glob = new Glob("**/*.mdx");
    const blogs = [];
    const blogContents: Record<string, string> = {};

    console.log(`Scanning for MDX files in ${BLOGS_DIR}...`);

    for await (const file of glob.scan({
        cwd: BLOGS_DIR,
        onlyFiles: true,
    })) {
        const filePath = path.join(BLOGS_DIR, file);
        const content = await readFile(filePath, "utf-8");

        const metadata = parseFrontmatter(content);
        if (metadata) {
            blogs.push(metadata);
            blogContents[metadata.slug] = content;
        } else {
            console.warn(`Warning: Could not find frontmatter in ${file}`);
        }
    }

    // Sort by date descending (newest first)
    blogs.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
    });

    // Add related posts based on tag overlap and recency
    for (const blog of blogs) {
        const related = blogs
            .filter((other) => other.slug !== blog.slug)
            .map((other) => {
                const overlap = (blog.tags || []).filter((tag: string) =>
                    (other.tags || []).includes(tag),
                ).length;
                return {
                    slug: other.slug,
                    score: overlap,
                    date: new Date(other.date).getTime(),
                };
            })
            // Only keep those with at least one matching tag
            .filter((item) => item.score > 0)
            .sort((a, b) => {
                // Primary sort: match score (descending)
                if (b.score !== a.score) return b.score - a.score;
                // Secondary sort: date (descending)
                return b.date - a.date;
            })
            .slice(0, 3)
            .map((item) => item.slug);

        blog.related = related;
    }

    // Upload images and delete local copies
    await uploadImages();

    // Update individual meta.json files, MDX files, and the global index with new URLs
    for (const blog of blogs) {
        const slug = blog.slug;
        const blogDir = path.join(BLOGS_DIR, slug);

        // Update meta.json
        const metaPath = path.join(blogDir, "meta.json");
        await writeFile(metaPath, JSON.stringify(blog, null, 4));

        // Update blog.mdx frontmatter and body content
        const mdxPath = path.join(blogDir, "blog.mdx");
        let content = blogContents[slug];
        if (!content) continue;
        const newFrontmatter = serializeFrontmatter(blog);
        const updatedContent = content.replace(
            /^---\r?\n[\s\S]*?\r?\n---/,
            newFrontmatter,
        );
        await writeFile(mdxPath, updatedContent);
    }

    const indexData = {
        lastUpdated: new Date().toISOString(),
        blogs,
    };

    await writeFile(INDEX_FILE, JSON.stringify(indexData, null, 4));
    console.log(
        `Successfully updated ${INDEX_FILE} with ${blogs.length} blogs.`,
    );
}

main().catch((err) => {
    console.error("Error updating blog index:", err);
    process.exit(1);
});
