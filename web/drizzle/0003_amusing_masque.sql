CREATE TABLE "tts_provider_usage" (
	"provider" text NOT NULL,
	"period_month" text NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_rate_limit_windows" (
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "client_submission_id" text;--> statement-breakpoint
ALTER TABLE "tts_rate_limit_windows" ADD CONSTRAINT "tts_rate_limit_windows_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tts_provider_usage_provider_month_idx" ON "tts_provider_usage" USING btree ("provider","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_rate_limit_user_provider_window_idx" ON "tts_rate_limit_windows" USING btree ("user_id","provider","window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_student_submission_idx" ON "attempts" USING btree ("student_id","client_submission_id");
