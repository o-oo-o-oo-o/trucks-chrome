#!/usr/bin/env bash
set -euo pipefail

# run with:
# ./convert_to_jpg.sh

IN_DIR="/Users/michaelhassin/brain/codes/trucks-311/playwright/media/raw"

if [ ! -d "$IN_DIR" ]; then
  echo "Error: '$IN_DIR' is not a directory"
  exit 1
fi

BASE_OUT="/Users/michaelhassin/brain/codes/trucks-311/playwright/media/ondeck"

mkdir -p "$BASE_OUT"
echo "Input directory: $IN_DIR"
echo "Output directory: $BASE_OUT"

shopt -s nullglob

# Loop over both .HEIC and .heic
for SRC in "$IN_DIR"/*.HEIC "$IN_DIR"/*.heic; do
  # If no matches, skip
  [ -e "$SRC" ] || continue

  FNAME=$(basename "$SRC")
  BASENAME="${FNAME%.*}"
  
  # Collision handling
  DST="$BASE_OUT/${BASENAME}.jpg"
  COUNTER=1
  while [ -e "$DST" ]; do
    DST="$BASE_OUT/${BASENAME}_${COUNTER}.jpg"
    ((COUNTER++))
  done

  echo "Converting: $SRC -> $DST"

  # 1) Convert HEIC -> JPEG (this may lose metadata, but we'll restore it)
  sips -s format jpeg "$SRC" --out "$DST" >/dev/null

  # 2) Copy all EXIF + file timestamps from the original HEIC to the new JPG
  #    -All:All             -> all metadata tags
  #    -FileCreateDate      -> filesystem creation time
  #    -FileModifyDate      -> filesystem modified time
  exiftool \
    -TagsFromFile "$SRC" \
    -All:All \
    '-FileCreateDate<FileCreateDate' \
    '-FileModifyDate<FileModifyDate' \
    -overwrite_original \
    "$DST" >/dev/null

  echo "Done: $DST"
  
  # Delete the original file
  rm "$SRC"
  echo "Deleted original: $SRC"
done

echo "All done. Files are in: $BASE_OUT"
