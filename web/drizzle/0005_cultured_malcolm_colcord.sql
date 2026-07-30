CREATE TABLE "organization_resource_usage" (
	"resource" text NOT NULL,
	"period_day" date NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_resource_usage_resource_day_idx" ON "organization_resource_usage" USING btree ("resource","period_day");