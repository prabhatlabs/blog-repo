import { Glob } from "bun";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const BLOGS_DIR = "./blogs";
const INDEX_FILE = "./data/blog-index.json";

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

async function main() {
    const glob = new Glob("*.mdx");
    const blogs = [];

    console.log(`Scanning for MDX files in ${BLOGS_DIR}...`);

    for await (const file of glob.scan(BLOGS_DIR)) {
        const filePath = path.join(BLOGS_DIR, file);
        const content = await readFile(filePath, "utf-8");

        const metadata = parseFrontmatter(content);
        if (metadata) {
            blogs.push(metadata);
        } else {
            console.warn(`Warning: Could not find frontmatter in ${file}`);
        }
    }

    // newest first
    blogs.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
    });

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
