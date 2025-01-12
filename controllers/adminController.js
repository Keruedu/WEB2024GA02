const User = require('../models/user');
const PaginationService = require('../service/paginationService');
const blogService = require('../service/blogService');
const { ITEMS_PER_PAGE } = require('../utils/constants');
const Category = require('../models/category');
const Tag = require('../models/tag');
const Blog = require('../models/blog');

// Trang admin dashboard
exports.getAdminPage = async (req, res) => {
  res.render('admin', {
    title: 'Admin Dashboard'
  });
};

// Trang quản lý users (code cũ)
exports.getUsersManagementPage = async (req, res) => {
  try {
    res.render('admin-usersManagement', { 
      title: 'Users Management',
      currentUser: req.user,
      searchQuery: '',
      filterType: 'username'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error loading page');
  }
};

exports.getUsersList = async (req, res) => {
  try {
    const result = await PaginationService.paginate(User, {
      page: parseInt(req.query.page) || 1,
      perPage: 3,
      searchQuery: req.query.search || '',
      filterField: req.query.filterType || 'username',
      selectFields: 'username email fullName role isPremium isBanned createdAt',
      sortField: req.query.sortField || 'username',
      sortOrder: req.query.sortOrder || 'asc'
    });

    res.json({
      users: result.items,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error loading users' });
  }
};

exports.getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).send('User not found');
    }
    res.render('admin-userDetails', { 
      user,
      title: 'User Details - Admin Dashboard'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Server error');
  }
};

exports.toggleUserBan = async (req, res) => {
  try {
    const { id } = req.params;
    const { isBanned } = req.body;
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot ban admin users' });
    }
    
    user.isBanned = isBanned;
    await user.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};


exports.getBlogs = async (req, res) => {
  try {
    // Ensure status is 'pending' if not provided
    if (!req.query.status) {
      req.query.status = 'pending';
    }

    const {
      blogs,
      totalBlogs,
      allCategories,
      allTags,
      page,
      url,
      search,
      filter,
      tags,
      category,
      timeRange,
      status
    } = await blogService.getBlogsHandler(req);

    if (req.xhr) {
      const blogsHtml = await blogService.renderBlogsHtml(blogs, req.user);
      const paginationHtml = await blogService.renderPaginationHtml(page, totalBlogs, url);
      return res.status(200).json({ blogsHtml, paginationHtml });
    } else {
      res.render('admin-blogsManagement', {
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
        selectedTags: tags || [],
        selectedCategory: category || '',
        timeRange: timeRange || '',
        status // Include status in the rendering context
      });
    }
  } catch (error) {
    console.error('Error in getBlogs:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Change status of selected blogs
exports.changeStatusBlogs = async (req, res) => {
  try {
    const { blogIds, status } = req.body;
    await blogService.changeStatusBlogs(blogIds, status);
    res.status(200).json({ success_msg: 'Blog statuses updated successfully' });
  } catch (error) {
    console.error('Error changing blog statuses:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Change status of a single blog
exports.changeBlogStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await blogService.changeBlogStatus(id, status);
    res.status(200).json({ success_msg: 'Blog status updated successfully' });
  } catch (error) {
    console.error('Error changing blog status:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
}

exports.getCategoriesAndTags = async (req, res) => {
  try {
    // Categories - sắp xếp theo tên và Uncategorized xuống cuối
    const categories = await Category.aggregate([
      {
        $lookup: {
          from: 'blogs',
          localField: '_id',
          foreignField: 'category',
          as: 'blogs'
        }
      },
      {
        $project: {
          name: 1,
          blogs: 1,
          blogsCount: { $size: '$blogs' },
          sortName: { $toLower: '$name' },
          isUncategorized: {
            $cond: { 
              if: { $eq: ['$name', 'Uncategorized'] }, 
              then: 1, 
              else: 0 
            }
          }
        }
      },
      {
        $sort: { 
          isUncategorized: 1,  // Uncategorized xuống cuối
          sortName: 1          // Sắp xếp theo tên (case-insensitive)
        }
      }
    ]);

    // Tags - chỉ sắp xếp theo tên
    const tags = await Tag.aggregate([
      {
        $lookup: {
          from: 'blogs',
          localField: '_id',
          foreignField: 'tags',
          as: 'blogs'
        }
      },
      {
        $project: {
          name: 1,
          blogs: 1,
          blogsCount: { $size: '$blogs' },
          sortName: { $toLower: '$name' }
        }
      },
      {
        $sort: { 
          sortName: 1  // Chỉ sắp xếp theo tên (case-insensitive)
        }
      }
    ]);

    res.render('admin-categoriesTags', {
      title: 'Categories & Tags Management',
      categories,
      tags,
      categoriesCount: categories.length,
      tagsCount: tags.length
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Server error');
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Tìm hoặc tạo category Uncategorized
    let uncategorized = await Category.findOne({ name: 'Uncategorized' });
    if (!uncategorized) {
      uncategorized = await Category.create({ name: 'Uncategorized' });
    }

    // Cập nhật tất cả blogs từ category bị xóa sang Uncategorized
    await Blog.updateMany(
      { category: id },
      { category: uncategorized._id }
    );

    // Xóa category
    await Category.findByIdAndDelete(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Xóa tag khỏi tất cả blogs
    await Blog.updateMany(
      { tags: id },
      { $pull: { tags: id } }
    );

    // Xóa tag
    await Tag.findByIdAndDelete(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    // Kiểm tra tên category
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Kiểm tra category đã tồn tại
    const existingCategory = await Category.findOne({ 
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }  // Case insensitive
    });
    
    if (existingCategory) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    // Tạo category mới
    const category = await Category.create({ name: name.trim() });
    
    // Đảm bảo trả về JSON
    return res.json({ 
      success: true,
      category: {
        id: category._id,
        name: category.name
      }
    });

  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({ error: 'Failed to create category' });
  }
};

exports.createTag = async (req, res) => {
  try {
    const { name } = req.body;

    // Kiểm tra tên tag
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    // Kiểm tra tag đã tồn tại
    const existingTag = await Tag.findOne({ 
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }  // Case insensitive
    });
    
    if (existingTag) {
      return res.status(400).json({ error: 'Tag already exists' });
    }

    // Tạo tag mới
    const tag = await Tag.create({ name: name.trim() });
    
    // Đảm bảo trả về JSON
    return res.json({ 
      success: true,
      tag: {
        id: tag._id,
        name: tag.name
      }
    });

  } catch (error) {
    console.error('Create tag error:', error);
    return res.status(500).json({ error: 'Failed to create tag' });
  }
};