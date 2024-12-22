const Blog = require('../models/blog');
const Tag = require('../models/tag');
const Category = require('../models/category');
const path = require('path');
const ejs = require('ejs');
const upload = require('../config/cloudinary');
const tag = require('../models/tag');
const mongoose = require('mongoose');

// Endpoint để xử lý ảnh tải lên
exports.uploadImage = (req, res) => {
  upload.single('upload')(req, res, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({
      url: req.file.path // URL của ảnh đã tải lên
    });
  });
};

// Get all blogs
exports.getAllBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find()
    .populate('author')
    .populate('category')
    .populate('tags');
    res.render('blog-grids', { blogs });
  } catch (error) {
    res.status(500).send(error.message);
  }
};

// Get blog by ID
exports.getBlogById = async (req, res) => {
  try {
    const blogId = req.params.id;
    const blog = await Blog.findById(blogId)
    .populate('author')
    .populate('category')
    .populate('tags');
    
    const relatedBlogs = await Blog.find({
      tags: { $in: blog.tags },
      _id: { $ne: blogId }
    }).limit(3).populate('category'); 

    res.render('blog-details', { blog, relatedBlogs });

  } catch (error) {
    res.status(500).send(error.message);
  }
};

exports.createBlog = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { title, content, category, tags: rawTags } = req.body;

    // Validate input
    if (!title || !content || !category || !req.file) {
      return res.status(400).json({
        errors: {
          title: !title ? 'Title is required' : undefined,
          content: !content ? 'Content is required' : undefined,
          category: !category ? 'Category is required' : undefined,
          image: !req.file ? 'Image is required' : undefined,
        },
      });
    }

    // Parse and sanitize tags (if provided)
    const tags = rawTags
      ? rawTags.split(',').map(tag => tag.trim()).filter(tag => tag) // Remove empty strings
      : [];

    // Get image URL from Cloudinary
    const imageUrl = req.file.path;

    // Process tags if provided
    let allTagIds = [];
    if (tags.length > 0) {
      const existingTags = await Tag.find({ name: { $in: tags } }).session(session);
      const existingTagNames = existingTags.map(tag => tag.name);

      // Create new tags if necessary
      const newTagNames = tags.filter(tagName => !existingTagNames.includes(tagName));
      let newTagDocs = [];
      if (newTagNames.length > 0) {
        newTagDocs = await Tag.insertMany(
          newTagNames.map(name => ({ name })),
          { session }
        );
      }

      // Combine all tag IDs
      allTagIds = [
        ...existingTags.map(tag => tag._id),
        ...newTagDocs.map(tag => tag._id),
      ];
    }

    // Create new blog
    const newBlog = new Blog({
      title,
      content,
      imageUrl,
      category,
      tags: allTagIds, // Can be empty
      author: req.user._id,
      date: new Date(),
      views: 0,
    });

    await newBlog.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success_msg: 'Blog created successfully', blog: newBlog });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();
    session.endSession();

    console.error('Error creating blog:', error);

    res.status(500).json({
      errors: {
        server: 'An error occurred while creating the blog. Please try again later.',
        details: error.message,
      },
    });
  }
};





const ITEMS_PER_PAGE = 9;


const getBlogsHandler = async (req, res) => {
  const { search, filter, tags, category, timeRange } = req.query;
  const url = req.url;
  const page = parseInt(req.query.page) || 1;
  let query = {};
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { content: { $regex: search, $options: 'i' } }
    ];
  }
  if (category) {
    query.category = category;
  }

  let tagsArray = [];
  if (tags) {
    tagsArray = Array.isArray(tags) ? tags : [tags];
    query.tags = { $in: tagsArray };
  }

  if (timeRange) {
    const now = new Date();
    let startDate;
    switch (timeRange) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
    }
    if (startDate) query.date = { $gte: startDate };
  }

  let sort = {};
  if (filter === 'latest') sort.date = -1;
  if (filter === 'oldest') sort.date = 1;
  if (filter === 'popular') sort.views = -1;

  try {
    const totalBlogs = await Blog.countDocuments(query);
    const blogs = await Blog.find(query)
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE)
      .sort(sort)
      .populate('author', 'name')
      .populate('category', 'name')
      .populate('tags', 'name');

    const allCategories = await Category.find().catch(err => {
      console.error('Error fetching categories:', err);
      throw err;
    });

    const allTags = await Tag.find().catch(err => {
      console.error('Error fetching tags:', err);
      throw err;
    });
    
    if (req.xhr) {
      const blogsHtml = await ejs
        .renderFile(path.join(__dirname, '../views/partials/blogs.ejs'), { blogs })
        .catch(err => {
          console.error('Error rendering blogsHtml:', err);
          throw err;
        });

      const paginationHtml = await ejs
        .renderFile(path.join(__dirname, '../views/partials/pagination.ejs'), {
          currentPage: page,
          hasNextPage: ITEMS_PER_PAGE * page < totalBlogs,
          hasPreviousPage: page > 1,
          nextPage: page + 1,
          previousPage: page - 1,
          lastPage: Math.ceil(totalBlogs / ITEMS_PER_PAGE),
          oldUrl : url 
        })
        .catch(err => {
          console.error('Error rendering paginationHtml:', err);
          throw err;
        });

      return res.status(200).json({ blogsHtml, paginationHtml });
    } else {
      res.render('blog-grids', {
        blogs,
        currentPage: page,
        hasNextPage: ITEMS_PER_PAGE * page < totalBlogs,
        hasPreviousPage: page > 1,
        nextPage: page + 1,
        previousPage: page - 1,
        lastPage: Math.ceil(totalBlogs / ITEMS_PER_PAGE),
        search,
        filter,
        tags: allTags,
        categories: allCategories,
        selectedTags: tagsArray || [],
        selectedCategory: category || '',
        timeRange: timeRange || ''
      });
    }
  } catch (error) {
    console.error('Error in getBlogsHandler:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};



// Get blogs with search and filter
exports.getBlogs = (req, res) => {
  getBlogsHandler(req, res);
};


// Create a new blog
exports.renderCreateBlogPage = async (req, res) => {
  try {
    const categories = await Category.find();
    const tags = await Tag.find();
    res.render('blog-create', { categories, tags });
  } catch (error) {
    console.error('Error rendering create blog page:', error);
    res.status(500).send('Internal Server Error');
  }
};
