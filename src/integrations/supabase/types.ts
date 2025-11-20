export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      baseline_shares: {
        Row: {
          baseline_id: string
          created_at: string | null
          id: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Insert: {
          baseline_id: string
          created_at?: string | null
          id?: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Update: {
          baseline_id?: string
          created_at?: string | null
          id?: string
          shared_by_user_id?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_shares_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "product_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_prices: {
        Row: {
          average_price: number | null
          baseline_id: string | null
          currency: string
          fetch_status: string | null
          highest_price: number | null
          id: string
          last_updated: string | null
          lowest_price: number | null
          marketplace: string
          merchant_id: string
          products_found: number | null
        }
        Insert: {
          average_price?: number | null
          baseline_id?: string | null
          currency: string
          fetch_status?: string | null
          highest_price?: number | null
          id?: string
          last_updated?: string | null
          lowest_price?: number | null
          marketplace: string
          merchant_id: string
          products_found?: number | null
        }
        Update: {
          average_price?: number | null
          baseline_id?: string | null
          currency?: string
          fetch_status?: string | null
          highest_price?: number | null
          id?: string
          last_updated?: string | null
          lowest_price?: number | null
          marketplace?: string
          merchant_id?: string
          products_found?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_prices_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "product_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_products: {
        Row: {
          baseline_id: string
          created_at: string | null
          currency: string
          id: string
          marketplace: string
          merchant_id: string
          price: number
          price_ratio: number
          product_name: string
          product_url: string | null
          rank: number
          similarity_score: number
        }
        Insert: {
          baseline_id: string
          created_at?: string | null
          currency: string
          id?: string
          marketplace: string
          merchant_id: string
          price: number
          price_ratio: number
          product_name: string
          product_url?: string | null
          rank: number
          similarity_score: number
        }
        Update: {
          baseline_id?: string
          created_at?: string | null
          currency?: string
          id?: string
          marketplace?: string
          merchant_id?: string
          price?: number
          price_ratio?: number
          product_name?: string
          product_url?: string | null
          rank?: number
          similarity_score?: number
        }
        Relationships: []
      }
      email_verifications: {
        Row: {
          attempts: number | null
          code_hash: string
          created_at: string | null
          email: string
          expires_at: string
          id: string
          user_id: string
          verification_code: string
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number | null
          code_hash: string
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          user_id: string
          verification_code: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number | null
          code_hash?: string
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          user_id?: string
          verification_code?: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: []
      }
      inflation_snapshots: {
        Row: {
          fetched_at: string | null
          id: string
          inflation_rate: number
          source: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          inflation_rate: number
          source?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          inflation_rate?: number
          source?: string | null
        }
        Relationships: []
      }
      pricing_results: {
        Row: {
          base_elasticity: number
          baseline_id: string | null
          calibrated_elasticity: number
          competitor_factor: number
          created_at: string | null
          currency: string
          expected_monthly_profit: number | null
          has_warning: boolean | null
          id: string
          inflation_adjustment: number
          inflation_rate: number
          market_average: number | null
          market_highest: number | null
          market_lowest: number | null
          merchant_id: string
          optimal_price: number
          position_vs_market: number | null
          profit_increase_amount: number | null
          profit_increase_percent: number | null
          suggested_price: number
          warning_message: string | null
        }
        Insert: {
          base_elasticity: number
          baseline_id?: string | null
          calibrated_elasticity: number
          competitor_factor: number
          created_at?: string | null
          currency: string
          expected_monthly_profit?: number | null
          has_warning?: boolean | null
          id?: string
          inflation_adjustment: number
          inflation_rate: number
          market_average?: number | null
          market_highest?: number | null
          market_lowest?: number | null
          merchant_id: string
          optimal_price: number
          position_vs_market?: number | null
          profit_increase_amount?: number | null
          profit_increase_percent?: number | null
          suggested_price: number
          warning_message?: string | null
        }
        Update: {
          base_elasticity?: number
          baseline_id?: string | null
          calibrated_elasticity?: number
          competitor_factor?: number
          created_at?: string | null
          currency?: string
          expected_monthly_profit?: number | null
          has_warning?: boolean | null
          id?: string
          inflation_adjustment?: number
          inflation_rate?: number
          market_average?: number | null
          market_highest?: number | null
          market_lowest?: number | null
          merchant_id?: string
          optimal_price?: number
          position_vs_market?: number | null
          profit_increase_amount?: number | null
          profit_increase_percent?: number | null
          suggested_price?: number
          warning_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_results_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "product_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_status: {
        Row: {
          baseline_id: string | null
          current_step: string | null
          error_message: string | null
          id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          baseline_id?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          baseline_id?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_status_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "product_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      product_baselines: {
        Row: {
          base_elasticity: number
          category: string
          cost_per_unit: number
          created_at: string | null
          currency: string
          current_price: number
          current_quantity: number
          deleted_at: string | null
          id: string
          merchant_id: string
          product_name: string
        }
        Insert: {
          base_elasticity: number
          category: string
          cost_per_unit: number
          created_at?: string | null
          currency: string
          current_price: number
          current_quantity: number
          deleted_at?: string | null
          id?: string
          merchant_id: string
          product_name: string
        }
        Update: {
          base_elasticity?: number
          category?: string
          cost_per_unit?: number
          created_at?: string | null
          currency?: string
          current_price?: number
          current_quantity?: number
          deleted_at?: string | null
          id?: string
          merchant_id?: string
          product_name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          business_name: string | null
          created_at: string | null
          email_verified: boolean | null
          email_verified_at: string | null
          id: string
          phone: string | null
        }
        Insert: {
          business_name?: string | null
          created_at?: string | null
          email_verified?: boolean | null
          email_verified_at?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          business_name?: string | null
          created_at?: string | null
          email_verified?: boolean | null
          email_verified_at?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
