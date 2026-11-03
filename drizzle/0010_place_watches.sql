CREATE TABLE "place_watches" (
	"user_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"arrivals" boolean DEFAULT true NOT NULL,
	"departures" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_watches_user_id_place_id_pk" PRIMARY KEY("user_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "place_watches" ADD CONSTRAINT "place_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_watches" ADD CONSTRAINT "place_watches_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_watches" ADD CONSTRAINT "place_watches_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_watches_family_idx" ON "place_watches" USING btree ("family_id","place_id");