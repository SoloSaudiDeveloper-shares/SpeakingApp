CREATE TABLE "security_rate_limit_windows" (
	"scope" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_resource_usage" (
	"user_id" integer NOT NULL,
	"resource" text NOT NULL,
	"period_day" date NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_resource_usage" ADD CONSTRAINT "user_resource_usage_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "security_rate_limit_scope_subject_window_idx" ON "security_rate_limit_windows" USING btree ("scope","subject_hash","window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_resource_usage_user_resource_day_idx" ON "user_resource_usage" USING btree ("user_id","resource","period_day");