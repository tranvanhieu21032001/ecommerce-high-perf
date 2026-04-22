import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

async function seedUsers() {
  const defaultPassword = 'Abcdef1!';
  const hashedPassword = await argon2.hash(defaultPassword);

  const users = [
    {
      email: 'admin@example.com',
      firstName: 'System',
      lastName: 'Admin',
      role: Role.ADMIN,
      phoneNumber: '+12025550100',
      birthday: new Date('1990-01-01'),
    },
    {
      email: 'user1@example.com',
      firstName: 'Alice',
      lastName: 'Nguyen',
      role: Role.USER,
      phoneNumber: '+12025550101',
      birthday: new Date('1995-05-15'),
    },
    {
      email: 'user2@example.com',
      firstName: 'Bob',
      lastName: 'Tran',
      role: Role.USER,
      phoneNumber: '+12025550102',
      birthday: new Date('1997-09-20'),
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        phoneNumber: user.phoneNumber,
        birthday: user.birthday,
      },
      create: {
        email: user.email,
        password: hashedPassword,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        phoneNumber: user.phoneNumber,
        birthday: user.birthday,
      },
    });
  }

  return { count: users.length, defaultPassword };
}

async function seedCategories() {
  const categories = [
    {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Devices and gadgets including phones, laptops, and accessories',
      imageUrl: 'https://example.com/images/electronics.png',
      isActive: true,
    },
    {
      name: 'Books',
      slug: 'books',
      description: 'Printed books and e-books',
      imageUrl: 'https://example.com/images/books.png',
      isActive: true,
    },
    {
      name: 'Home Appliances',
      slug: 'home-appliances',
      description: 'Appliances for everyday home usage',
      imageUrl: 'https://example.com/images/home-appliances.png',
      isActive: true,
    },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        imageUrl: category.imageUrl,
        isActive: category.isActive,
      },
      create: category,
    });
  }

  return categories.length;
}

async function seedProducts() {
  const electronics = await prisma.category.findUnique({
    where: { slug: 'electronics' },
    select: { id: true },
  });
  const books = await prisma.category.findUnique({
    where: { slug: 'books' },
    select: { id: true },
  });
  const homeAppliances = await prisma.category.findUnique({
    where: { slug: 'home-appliances' },
    select: { id: true },
  });

  if (!electronics || !books || !homeAppliances) {
    throw new Error('Missing categories for product seeding');
  }

  const products = [
    {
      name: 'Wireless Headphones',
      description: 'Bluetooth over-ear headphones with active noise cancellation',
      price: 129.99,
      stock: 100,
      sku: 'EL-WH-001',
      imageUrl: 'https://example.com/images/wireless-headphones.png',
      isActive: true,
      categoryId: electronics.id,
    },
    {
      name: 'Mechanical Keyboard',
      description: 'Compact mechanical keyboard with RGB backlight',
      price: 89.5,
      stock: 80,
      sku: 'EL-MK-002',
      imageUrl: 'https://example.com/images/mechanical-keyboard.png',
      isActive: true,
      categoryId: electronics.id,
    },
    {
      name: 'Clean Architecture',
      description: 'Book about software architecture principles and practices',
      price: 34.99,
      stock: 60,
      sku: 'BK-CA-001',
      imageUrl: 'https://example.com/images/clean-architecture.png',
      isActive: true,
      categoryId: books.id,
    },
    {
      name: 'Air Fryer 5L',
      description: '5-liter digital air fryer with multiple cooking modes',
      price: 149.0,
      stock: 40,
      sku: 'HA-AF-001',
      imageUrl: 'https://example.com/images/air-fryer.png',
      isActive: true,
      categoryId: homeAppliances.id,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        name: product.name,
        description: product.description,
        price: product.price,
        stock: product.stock,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
        categoryId: product.categoryId,
      },
      create: product,
    });
  }

  return products.length;
}

async function main() {
  const usersResult = await seedUsers();
  const categoriesCount = await seedCategories();
  const productsCount = await seedProducts();

  console.log('Seed completed successfully');
  console.log(`Users: ${usersResult.count} (default password: ${usersResult.defaultPassword})`);
  console.log(`Categories: ${categoriesCount}`);
  console.log(`Products: ${productsCount}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
