"""Configurable private S3 storage and SMTP password recovery delivery."""
import io
import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import quote
import boto3
from PIL import Image, UnidentifiedImageError
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


def s3_client():
    return boto3.client("s3", endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        region_name=os.environ.get("AWS_REGION", "us-east-1"))


def put_private(path, data):
    s3_client().put_object(Bucket=os.environ["S3_BUCKET"], Key=path, Body=data,
        ContentType="image/jpeg", ServerSideEncryption="AES256")


def get_private(path):
    obj = s3_client().get_object(Bucket=os.environ["S3_BUCKET"], Key=path)
    return obj["Body"].read(), obj.get("ContentType", "image/jpeg")


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
