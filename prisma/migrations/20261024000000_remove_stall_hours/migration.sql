-- Stalls are now open all the time, from the moment they are created.
ALTER TABLE "Stall" DROP CONSTRAINT IF EXISTS "Stall_hours_check";
ALTER TABLE "Stall" DROP COLUMN "openHour",
DROP COLUMN "closeHour";
