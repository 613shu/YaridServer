-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('BEGINNER', 'EXPERIENCED', 'GVIR');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('YOUNG', 'OLD');

-- CreateEnum
CREATE TYPE "TargetGender" AS ENUM ('ANY', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "TargetAge" AS ENUM ('ANY', 'YOUNG', 'OLD');

-- CreateEnum
CREATE TYPE "StallStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('OPENING_GRANT', 'STALL_PURCHASE', 'STOCK_PURCHASE', 'DECORATION', 'STALL_FEE', 'SALE_INCOME', 'LOAN_TAKEN', 'LOAN_REPAYMENT', 'ADMIN_GRANT', 'STALL_SOLD', 'STALL_CLOSED_REFUND');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('OPEN', 'REPAID');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUSPENSION', 'UNSUSPENSION', 'GRANT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" VARCHAR(30) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MERCHANT',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "status" "MerchantStatus" NOT NULL DEFAULT 'BEGINNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "description" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "supplierPrice" INTEGER NOT NULL,
    "marketPrice" INTEGER NOT NULL,
    "popularity" INTEGER NOT NULL,
    "targetGender" "TargetGender" NOT NULL DEFAULT 'ANY',
    "targetAge" "TargetAge" NOT NULL DEFAULT 'ANY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stall" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "openHour" INTEGER NOT NULL,
    "closeHour" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "StallStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspensionReason" TEXT,
    "slotNumber" INTEGER NOT NULL,
    "decorationSpent" INTEGER NOT NULL DEFAULT 0,
    "stockOutTicks" INTEGER NOT NULL DEFAULT 0,
    "totalTicks" INTEGER NOT NULL DEFAULT 0,
    "createdGameDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decoration" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "Decoration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StallDecoration" (
    "stallId" INTEGER NOT NULL,
    "decorationId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StallDecoration_pkey" PRIMARY KEY ("stallId","decorationId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "nickname" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "ageGroup" "AgeGroup" NOT NULL,
    "dailyBudget" INTEGER NOT NULL,
    "budgetLeft" INTEGER NOT NULL,
    "visitHour" INTEGER NOT NULL,
    "shoppingList" JSONB NOT NULL,
    "listDay" INTEGER NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "stallId" INTEGER,
    "merchantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerGender" "Gender" NOT NULL,
    "customerAge" "AgeGroup" NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "gameDay" INTEGER NOT NULL,
    "gameHour" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDailySummary" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "stallId" INTEGER,
    "productId" INTEGER NOT NULL,
    "gameDay" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL,
    "maleCount" INTEGER NOT NULL,
    "femaleCount" INTEGER NOT NULL,
    "youngCount" INTEGER NOT NULL,
    "oldCount" INTEGER NOT NULL,

    CONSTRAINT "SalesDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT,
    "stallId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repaidAt" TIMESTAMP(3),

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currentDay" INTEGER NOT NULL DEFAULT 1,
    "currentHour" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Stall_slotNumber_key" ON "Stall"("slotNumber");

-- CreateIndex
CREATE INDEX "Stall_merchantId_idx" ON "Stall"("merchantId");

-- CreateIndex
CREATE INDEX "Stall_productId_idx" ON "Stall"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Decoration_name_key" ON "Decoration"("name");

-- CreateIndex
CREATE INDEX "Customer_visitHour_idx" ON "Customer"("visitHour");

-- CreateIndex
CREATE INDEX "Sale_merchantId_gameDay_idx" ON "Sale"("merchantId", "gameDay");

-- CreateIndex
CREATE INDEX "Sale_stallId_idx" ON "Sale"("stallId");

-- CreateIndex
CREATE INDEX "Sale_gameDay_idx" ON "Sale"("gameDay");

-- CreateIndex
CREATE INDEX "SalesDailySummary_merchantId_gameDay_idx" ON "SalesDailySummary"("merchantId", "gameDay");

-- CreateIndex
CREATE INDEX "Transaction_merchantId_createdAt_idx" ON "Transaction"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Loan_merchantId_status_idx" ON "Loan"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallDecoration" ADD CONSTRAINT "StallDecoration_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallDecoration" ADD CONSTRAINT "StallDecoration_decorationId_fkey" FOREIGN KEY ("decorationId") REFERENCES "Decoration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business rules enforced by the database
CREATE UNIQUE INDEX "Loan_one_open_per_merchant" ON "Loan"("merchantId") WHERE "status" = 'OPEN';
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_hours_check" CHECK ("openHour" >= 0 AND "openHour" <= 23 AND "closeHour" >= 1 AND "closeHour" <= 24 AND "closeHour" > "openHour");
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_price_check" CHECK ("price" > 0);
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_stock_check" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_prices_check" CHECK ("supplierPrice" > 0 AND "marketPrice" > "supplierPrice");
ALTER TABLE "Product" ADD CONSTRAINT "Product_popularity_check" CHECK ("popularity" >= 1 AND "popularity" <= 100);
