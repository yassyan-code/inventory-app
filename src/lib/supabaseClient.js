import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。' +
      '.env ファイルを作成し、.env.example を参考に値を設定してください。'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
