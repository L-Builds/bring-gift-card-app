"""Configurable private S3 storage and SMTP password recovery delivery."""
import io
import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import quote
import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException


def clean_image(data):
    try:
        Image.MAX_IMAGE_PIXELS = 25000000
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {"JPEG", "PNG", "WEBP"} or im.width * im.height > 25000000:
                raise ValueError("Unsupported image")
            im.load()
            result = io.BytesIO()
            im.convert("RGB").save(result, format="JPEG", quality=92)
            return result.getvalue()
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "Upload a valid JPEG, PNG or WebP image")


def clean_brand_logo(data):
    """Normalize a validated upload to a small square PNG for public display."""
    try:
        Image.MAX_IMAGE_PIXELS = 25000000
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {"JPEG", "PNG", "WEBP"} or im.width * im.height > 25000000:
                raise ValueError("Unsupported image")
            im.load()
            contained = ImageOps.contain(ImageOps.exif_transpose(im).convert("RGBA"), (512, 512))
            canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            canvas.alpha_composite(contained, ((512 - contained.width) // 2, (512 - contained.height) // 2))
            result = io.BytesIO()
            canvas.save(result, format="PNG", optimize=True)
            return result.getvalue()
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "Upload a valid JPEG, PNG or WebP image")


def s3_client():
    return boto3.client("s3", endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        region_name=os.environ.get("AWS_REGION", "us-east-1"))


def put_private(path, data, content_type="image/jpeg"):
    s3_client().put_object(Bucket=os.environ["S3_BUCKET"], Key=path, Body=data,
        ContentType=content_type, ServerSideEncryption="AES256")


def get_private(path):
    obj = s3_client().get_object(Bucket=os.environ["S3_BUCKET"], Key=path)
    return obj["Body"].read(), obj.get("ContentType", "image/jpeg")


def delete_private(path):
    """Delete an unneeded private object, then verify that it is no longer readable."""
    client = s3_client()
    bucket = os.environ["S3_BUCKET"]
    client.delete_object(Bucket=bucket, Key=path)
    try:
        client.head_object(Bucket=bucket, Key=path)
    except ClientError as exc:
        if str(exc.response.get("Error", {}).get("Code", "")) in {"404", "NoSuchKey", "NotFound"}:
            return
        raise
    raise RuntimeError("Private object still exists after deletion")


def send_reset(address, token):
    host = os.environ.get("SMTP_HOST", "")
    sender = os.environ.get("SMTP_FROM", "")
    if not host or not sender:
        raise RuntimeError("Password reset email is not configured")
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = sender, address, "Reset your Bring Gift Card password"
    url = os.environ.get("PUBLIC_APP_URL", "").rstrip("/") + "/forgot-password?token=" + quote(token)
    message.set_content("Use this link within 30 minutes to reset your password:\n" + url +
        "\n\nOr enter this reset code in the app:\n" + token + "\n\nIf you did not request this, ignore this email.")
    port = int(os.environ.get("SMTP_PORT", "587"))
    implicit = os.environ.get("SMTP_SSL", "false").lower() == "true"
    smtp_type = smtplib.SMTP_SSL if implicit else smtplib.SMTP
    with smtp_type(host, port, timeout=20) as smtp:
        if not implicit:
            smtp.starttls(context=ssl.create_default_context())
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(message)
