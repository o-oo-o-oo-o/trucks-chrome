#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "digest"
require "time"

URL = "https://webcams.nyctmc.org/api/cameras/a9979a0c-71f2-4f5e-a87c-4d29c1104d5c/image"
INTERVAL_SECONDS = 1
RECENT_FILES_TO_CHECK = 3

SCRIPT_DIR = File.expand_path(File.dirname(__FILE__))
MEDIA_DIR  = File.join(SCRIPT_DIR, "media")
ARCHIVED_DIR = File.join(SCRIPT_DIR, "archived")
FileUtils.mkdir_p(MEDIA_DIR)
FileUtils.mkdir_p(ARCHIVED_DIR)

def timestamp_filename(now = Time.now)
  now.strftime("%Y-%m-%d-%H-%M-%S") + ".jpg"
end

def most_recent_files(dir, n)
  Dir.glob(File.join(dir, "*.jpg"))
     .sort_by { |p| File.mtime(p) }
     .reverse
     .first(n)
end

def sha256_bytes(bytes)
  Digest::SHA256.digest(bytes)
end

def dup_of_recent?(bytes, recent_paths)
  new_hash = sha256_bytes(bytes)
  recent_paths.any? do |path|
    begin
      sha256_bytes(File.binread(path)) == new_hash
    rescue Errno::ENOENT
      false
    end
  end
end

def fetch_image_bytes_with_curl(url)
  # -f: fail on HTTP errors, -sS: silent but show errors, -L: follow redirects
  # --max-time: hard timeout
  cmd = ["curl", "-f", "-sS", "-L", "--max-time", "15", url]

  bytes = IO.popen(cmd, "rb", err: [:child, :out]) { |io| io.read }
  status = $?

  unless status&.success?
    raise "curl failed (exit=#{status&.exitstatus}). Output: #{bytes.to_s.strip}"
  end

  # basic JPEG magic bytes check
  if bytes.nil? || bytes.bytesize < 4 || bytes.getbyte(0) != 0xFF || bytes.getbyte(1) != 0xD8
    raise "Response did not look like a JPEG (size=#{bytes&.bytesize || 0})"
  end

  bytes
end

puts "Saving non-duplicate frames to: #{MEDIA_DIR}"
puts "Archiving old frames to: #{ARCHIVED_DIR}"
puts "Polling: #{URL}"
puts "Interval: #{INTERVAL_SECONDS}s; dup-check last #{RECENT_FILES_TO_CHECK} saved files"
puts "Press Ctrl+C to stop."

loop do
  begin
    bytes = fetch_image_bytes_with_curl(URL)
    recent = most_recent_files(MEDIA_DIR, RECENT_FILES_TO_CHECK)

    if dup_of_recent?(bytes, recent)
      puts "[#{Time.now.iso8601}] dup vs recent (#{recent.size} checked) — skipping"
    else
      filename = timestamp_filename
      path = File.join(MEDIA_DIR, filename)

      # avoid collision if multiple saves happen in same second
      if File.exist?(path)
        base = File.basename(filename, ".jpg")
        i = 1
        loop do
          candidate = File.join(MEDIA_DIR, "#{base}_#{i}.jpg")
          unless File.exist?(candidate)
            path = candidate
            break
          end
          i += 1
        end
      end

      File.binwrite(path, bytes)
      puts "[#{Time.now.iso8601}] saved #{File.basename(path)} (#{bytes.bytesize} bytes)"

      # Cleanup old files (> 15 minutes) -> Move to archived
      cutoff_time = Time.now - (15 * 60)
      Dir.glob(File.join(MEDIA_DIR, "*.jpg")).each do |f|
        if File.mtime(f) < cutoff_time
          FileUtils.mv(f, ARCHIVED_DIR)
        end
      end
    end
  rescue => e
    warn "[#{Time.now.iso8601}] error: #{e.class}: #{e.message}"
  ensure
    sleep INTERVAL_SECONDS
  end
end
