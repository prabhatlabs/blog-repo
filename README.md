# Blog Repository

This repository hosts blog posts in MDX format.

## How to add a new blog

1. Create a new folder under `blogs/` using the blog's slug as the folder name.
2. Inside that folder, create a `blog.mdx` file.
3. At the top of your `blog.mdx` file, include the required metadata as frontmatter:

   ```md
   ---
   slug: "your-blog-slug"
   title: "Blog Title"
   date: "YYYY-MM-DD"
   description: "Short description of the blog"
   tags: ["tag1", "tag2"]
   coverImage: "/blog-images/<slug>/your-image.jpg"
   published: true
   ---
   ```

4. If your blog includes images, place them inside a folder named `blog-images/<slug>/` in the repository root.
